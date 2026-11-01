import unittest
from unittest.mock import patch

from paybybot3 import bot as botmod, web
from paybybot3.bot import Bot


def bare_bot():
    b = Bot.__new__(Bot)  # no login: only the methods under test run
    return b


class VendorKept(unittest.TestCase):
    def setUp(self):
        botmod._VENDORS.clear()

    def test_a_zones_vendor_is_asked_once_for_all_accounts(self):
        answer = {"getLocationsV1": [{"locationId": "75017", "legacyVendorId": 42}]}
        with patch.object(Bot, "_graphql", return_value=answer) as graphql:
            self.assertEqual(bare_bot()._get_vendor_id("75017"), 42)
            self.assertEqual(bare_bot()._get_vendor_id(75017), 42)
        self.assertEqual(graphql.call_count, 1)

    def test_an_unknown_zone_is_asked_again(self):
        with patch.object(Bot, "_graphql", return_value={"getLocationsV1": []}) as graphql:
            bare_bot()._get_vendor_id("1")
            bare_bot()._get_vendor_id("1")
        self.assertEqual(graphql.call_count, 2)


class CardsOncePerPayment(unittest.TestCase):
    def test_the_cards_are_asked_once_for_several_lookups(self):
        b = bare_bot()
        cards = {"paymentCards": [{"paymentAccountId": "c1", "cardType": "Visa", "paymentScope": "s"}]}
        with patch.object(Bot, "get_payment_accounts", return_value=cards) as accounts:
            self.assertEqual(b._resolve_payment("c1"), ("Visa", "s"))
            self.assertEqual(b._resolve_payment("c1"), ("Visa", "s"))
        self.assertEqual(accounts.call_count, 1)


class AdminKept(unittest.TestCase):
    def setUp(self):
        web._admin_parking.clear()

    def test_reopening_the_admin_does_not_log_in_again(self):
        logins = []

        class FakeBot:
            def get_vehicles(self):
                return [{"licensePlate": "AB123CD"}]

            def get_parking_sessions(self):
                return []

        def login(_, owner):
            logins.append(owner)
            return FakeBot()
        rows = [{"owner": "o1", "data": "x", "renewals_active": 1}]
        with patch.object(web, "HOSTED", True), patch.object(web, "require_admin"), \
                patch.object(web, "store", return_value=rows), patch.object(web, "bot_from_refresh", side_effect=login), \
                patch.object(web, "_fernet") as fernet:
            fernet.return_value.decrypt.return_value = b"{}"
            web.admin_clients(None)
            clients = web.admin_clients(None)
        self.assertEqual(logins, ["o1"])
        self.assertEqual(clients[0]["vehicles"], [{"plate": "AB123CD", "expire": None, "resident": None,
                                                    "covered": False, "renewal": None, "advanced": False}])

    def test_a_ticket_advanced_from_the_backup_account_shows_as_running(self):
        import json
        from datetime import datetime, timedelta, timezone

        class FakeBot:
            def get_vehicles(self):
                return [{"licensePlate": "FJ-745-AC"}]

            def get_parking_sessions(self):
                return []  # the advanced ticket is on the owner's account, not the client's

            def get_payment_accounts(self):
                return {}
        until = datetime.now(timezone.utc) + timedelta(days=5)
        texts = {b"acc": b"{}", b"ren": json.dumps({"plate": "FJ745AC", "advanced_until": web.utc_iso(until)}).encode()}
        answers = {"admin_accounts": [{"owner": "o1", "data": "acc", "renewals_active": 1}],
                   "renewal_list": [{"id": "r", "enabled": True, "data": "ren"}]}
        with patch.object(web, "HOSTED", True), patch.object(web, "require_admin"), \
                patch.object(web, "store", side_effect=lambda fn, **k: answers.get(fn)), \
                patch.object(web, "bot_from_refresh", return_value=FakeBot()), \
                patch.object(web, "_fernet") as fernet:
            fernet.return_value.decrypt.side_effect = lambda b: texts[b]
            vehicle = web.admin_clients(None)[0]["vehicles"][0]
        self.assertTrue(vehicle["advanced"])
        self.assertEqual(web.parse_dt(vehicle["expire"]), web.parse_dt(web.utc_iso(until)))

    def test_each_vehicle_says_its_resident_rate_coverage_and_renewal(self):
        import json

        class FakeBot:
            def get_vehicles(self):
                return [{"licensePlate": p} for p in ("AB-123-CD", "GH456JK", "LM789NP")]

            def get_parking_sessions(self):
                return []

            def get_payment_accounts(self):
                return {}
        account = {"vehicle_zones": {"AB123CD": {"z": "75105", "t": 1}, "GH456JK": {"z": None, "t": 1}},
                   "chosen_plates": ["AB123CD"]}
        texts = {b"acc": json.dumps(account).encode(), b"ren": json.dumps({"plate": "AB-123-CD"}).encode()}
        answers = {"admin_accounts": [{"owner": "o1", "data": "acc", "renewals_active": 0}],
                   "renewal_list": [{"id": "r", "enabled": False, "data": "ren"}]}
        with patch.object(web, "HOSTED", True), patch.object(web, "require_admin"), \
                patch.object(web, "store", side_effect=lambda fn, **k: answers.get(fn)), \
                patch.object(web, "bot_from_refresh", return_value=FakeBot()), \
                patch.object(web, "_fernet") as fernet:
            fernet.return_value.decrypt.side_effect = lambda b: texts[b]
            vehicles = web.admin_clients(None)[0]["vehicles"]
        self.assertEqual([(v["plate"], v["resident"], v["covered"], v["renewal"]) for v in vehicles], [
            ("AB-123-CD", "75105", True, "Suspendu"),
            ("GH456JK", False, False, None),
            ("LM789NP", None, False, None),
        ])


class AddVehicle(unittest.TestCase):
    def test_a_vehicle_is_added_as_the_app_does(self):
        answer = {"addVehicleV1": {"addVehicleResponse": {"vehicleId": "v1"}}}
        with patch.object(Bot, "_graphql", return_value=answer) as graphql:
            self.assertEqual(bare_bot().add_vehicle("FT-630-FH", "FR", "", "Car"), "v1")
        self.assertEqual(graphql.call_args.args[1], {"input": {"request": {
            "profileName": "PayByPhone", "licensePlate": "FT-630-FH", "country": "FR", "jurisdiction": "",
            "type": "Car", "profile": {"photo": "", "description": ""}}}})
