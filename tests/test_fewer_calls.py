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
                                                    "covered": False, "renewal": None, "failure": None}])

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
            ("AB-123-CD", "75105", True, "Désactivé"),
            ("GH456JK", False, False, None),
            ("LM789NP", None, False, None),
        ])

    def test_a_failed_automation_is_the_problem_not_a_car_without_ticket(self):
        import json

        class FakeBot:
            def get_vehicles(self):
                return [{"licensePlate": p} for p in ("AB123CD", "GH456JK", "LM789NP")]

            def get_parking_sessions(self):
                return []

            def get_payment_accounts(self):
                return {}
        texts = {b"acc": b"{}", b"r1": json.dumps({"plate": "AB123CD"}).encode(),
                 b"r2": json.dumps({"plate": "GH456JK"}).encode()}
        answers = {"admin_accounts": [{"owner": "o1", "data": "acc", "renewals_active": 1}],
                   "renewal_list": [{"id": "1", "enabled": False, "data": "r1", "last_error": "Carte refusée."},
                                    {"id": "2", "enabled": True, "data": "r2", "last_error": "PayByPhone ne répond pas."}]}
        with patch.object(web, "HOSTED", True), patch.object(web, "require_admin"), \
                patch.object(web, "store", side_effect=lambda fn, **k: answers.get(fn)), \
                patch.object(web, "bot_from_refresh", return_value=FakeBot()), \
                patch.object(web, "_fernet") as fernet:
            fernet.return_value.decrypt.side_effect = lambda b: texts[b]
            vehicles = web.admin_clients(None)[0]["vehicles"]
        self.assertEqual([(v["plate"], v["renewal"], v["failure"]) for v in vehicles], [
            ("AB123CD", "Suspendu", "Carte refusée."),
            ("GH456JK", "Actif", "PayByPhone ne répond pas."),
            ("LM789NP", None, None),  # no ticket and nothing from PayByBot: no problem
        ])


class OverviewInOneRequest(unittest.TestCase):
    """The dashboard's three PayByPhone reads (vehicles, cards, tickets) go out as one GraphQL request."""

    def setUp(self):
        web.BUNDLE_REFUSED.clear()

    def test_the_three_reads_are_one_request(self):
        answer = {"getVehiclesV3": [{"licensePlate": "AB123CD"}],
                  "getPaymentAccountsV1": {"paymentCards": []},
                  "getParkingSessionsV1": [{"parkingSessionId": "1", "startTime": "2026-11-10T10:00:00Z",
                                            "expireTime": "2026-11-17T10:00:00Z", "vehicle": {"licensePlate": "AB123CD"}}]}
        with patch.object(Bot, "_graphql", return_value=answer) as graphql:
            vehicles, accounts, sessions = bare_bot().get_overview()
        self.assertEqual(graphql.call_count, 1)
        query = graphql.call_args[0][0]
        for field in ("getVehiclesV3", "getPaymentAccountsV1", "getParkingSessionsV1"):
            self.assertIn(field, query)
        self.assertEqual(vehicles[0]["licensePlate"], "AB123CD")
        self.assertEqual(accounts, {"paymentCards": []})
        self.assertEqual(sessions[0]["expireTime"].year, 2026)  # dates read as for the separate call

    def test_refused_once_the_separate_reads_take_over_and_it_is_not_asked_again(self):
        b = bare_bot()
        with patch.object(Bot, "_graphql", side_effect=RuntimeError("GraphQL error: unknown field")):
            self.assertIsNone(web.read_overview(web.UserSession.for_bot(b, "u")))
        self.assertTrue(web.BUNDLE_REFUSED)
        with patch.object(Bot, "_graphql") as graphql:
            self.assertIsNone(web.read_overview(web.UserSession.for_bot(b, "u")))
        graphql.assert_not_called()
