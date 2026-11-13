import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from paybybot3 import web


def ticket(plate, zone, hours=2):
    return {"parkingSessionId": "s1", "locationId": zone, "vehicle": {"licensePlate": plate},
            "expireTime": datetime.now(timezone.utc) + timedelta(hours=hours)}


class RunningTicket(unittest.TestCase):
    """A resident with a ticket already running can activate the renewal ahead of time."""

    def setUp(self):
        self.env = patch.dict(os.environ, {"PAYBYBOT_SECRET": "test-secret"})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def session(self, tickets, rates=None, cards=("c",)):
        rates = [{"ratePolicyId": "101", "name": "Résident", "type": "Resident"}] if rates is None else rates
        answers = {"get_parking_sessions": tickets, "get_rate_options": rates,
                   "get_payment_accounts": {"paymentCards": [{"paymentAccountId": c} for c in cards]}}
        s = MagicMock()
        s.call.side_effect = lambda name, *a, **k: answers.get(name)
        return s

    def test_any_zone_and_plate_spelling_count(self):
        s = self.session([ticket("FT-630-FH", "75015"), ticket("ZZ999ZZ", "75005"), ticket("FT630FH", "75005", -1)])
        self.assertEqual([x["locationId"] for x in web.running_for(s, "FT630FH")], ["75015"])

    def run_renewal(self, tickets, pay_error=None, last_error=None, **account):
        row = {"id": "r1", "owner": "o", "plate": "FT630FH", "location": "75005", "rate": "101", "duration": 7,
               "unit": "Days", "payment_account_id": "c", "last_error": last_error}
        stored = []
        bot = MagicMock(refresh_token="t")
        with patch.object(web, "with_details", side_effect=lambda r: r), \
                patch.object(web, "guarded_state", return_value="ok"), \
                patch.object(web, "store", side_effect=lambda *a, **k: stored.append(k)), \
                patch.object(web, "notify") as mail, \
                patch.object(web.Bot, "from_refresh_token", return_value=bot), \
                patch.object(web.UserSession, "for_bot", return_value=self.session(tickets, **account)), \
                patch.object(web, "pay_and_confirm", side_effect=pay_error or AssertionError("must not pay")) as pay:
            outcome = web.process_renewal(row, refresh_token="t")
        return outcome, stored[-1]["p_patch"], mail, pay

    def test_waits_for_a_ticket_running_in_another_zone(self):
        outcome, patch_, mail, pay = self.run_renewal([ticket("FT-630-FH", "75015")])
        self.assertEqual(outcome, "active")
        pay.assert_not_called()
        mail.assert_not_called()
        self.assertIsNone(patch_["last_error"])

    def test_vehicle_already_parked_is_not_an_error(self):
        refused = RuntimeError('Quote error: [{"reason": "VehicleAlreadyParked"}]')
        outcome, patch_, mail, _ = self.run_renewal([], pay_error=refused)
        self.assertEqual(outcome, "active")
        self.assertIsNone(patch_["last_error"])
        mail.assert_not_called()

    def test_week_price_from_history_then_paris_rate(self):
        now = datetime.now(timezone.utc)
        week = {"vehicle": {"licensePlate": "FT-630-FH"}, "ratePolicy": {"ratePolicyId": "101"},
                "startTime": now - timedelta(days=20), "expireTime": now - timedelta(days=13),
                "totalCost": {"amount": 9.5, "currency": "EUR"}}
        resident = [{"ratePolicyId": "101", "name": "Résident", "type": "Resident"}]
        body = web.QuoteRequest(location="75005", rate="101", duration=7, unit="Days", plate="FT630FH",
                                paymentAccountId="c", renewal=True)

        def session(history):
            s = MagicMock()
            s.call.side_effect = lambda name, *a, **k: {"get_past_sessions": history, "get_parking_sessions": [],
                                                        "get_rate_options": resident}[name]
            return s

        self.assertEqual(web.known_price(session([week]), body), ({"amount": 9.5, "currency": "EUR"}, "history"))
        self.assertEqual(web.known_price(session([]), body), (web.PARIS_RESIDENT_WEEK, "paris"))
        self.assertEqual(web.known_price(session([]), body.model_copy(update={"location": "69001"})), (None, None))

    def test_a_week_stopped_early_is_found(self):
        now = datetime.now(timezone.utc)
        row = {"plate": "FT630FH", "location": "75005", "rate": "101"}

        def past(days, status="Completed"):
            start = now - timedelta(days=10)
            return {"parkingSessionId": "p%s" % days, "status": status, "locationId": "75005",
                    "vehicle": {"licensePlate": "FT-630-FH"}, "ratePolicy": {"ratePolicyId": "101"},
                    "startTime": start, "expireTime": start + timedelta(days=days)}
        s = MagicMock()
        s.call.side_effect = lambda name, *a, **k: [past(7), past(14), past(2.5, "Stopped")]
        stops = web.early_stops(s, row)
        self.assertEqual([x["session"] for x in stops], ["p2.5"])  # full weeks (one or extended) are not stops
        self.assertEqual(stops[0]["status"], "Stopped")

    def test_a_capped_extension_is_not_the_week_price(self):
        now = datetime.now(timezone.utc)
        running = ticket("FT630FH", "75005", hours=24 * 7)
        week = {"vehicle": {"licensePlate": "FT-630-FH"}, "ratePolicy": {"ratePolicyId": "101"},
                "startTime": now - timedelta(days=20), "expireTime": now - timedelta(days=13),
                "totalCost": {"amount": 5.0, "currency": "EUR"}}
        body = web.QuoteRequest(location="75005", rate="101", duration=7, unit="Days", plate="FT630FH",
                                paymentAccountId="c", renewal=True)

        def call(name, *a, **k):
            if name == "_create_quote":
                if k["operation"] == "Start":
                    raise RuntimeError("VehicleAlreadyParked")
                # PayByPhone caps it: a few hours more, not a week
                return {"cost": {"amount": 1.25, "currency": "EUR"},
                        "details": {"parkingExpiryTime": (running["expireTime"] + timedelta(hours=6)).isoformat()}}
            return {"get_parking_sessions": [running], "get_past_sessions": [week]}.get(name, [])
        s = MagicMock()
        s.call.side_effect = call
        with patch.object(web, "current", return_value=s):
            q = web.quote(body, "t")
        self.assertEqual((q["cost"], q.get("priceSource"), q["afterCurrent"]),
                         ({"amount": 5.0, "currency": "EUR"}, "history", True))

    def test_resident_rate_refused_is_said_before_paying(self):
        refused = [{"ratePolicyId": "101", "name": "Résident", "parkingNotAllowedReason": "PermitExpired"}]
        outcome, patch_, _, pay = self.run_renewal([], rates=refused)
        self.assertEqual(outcome, "not_payable")
        pay.assert_not_called()
        self.assertIn("PermitExpired", patch_["last_error"])

    def test_no_card_is_said_before_paying(self):
        outcome, patch_, _, pay = self.run_renewal([], cards=())
        self.assertEqual(outcome, "not_payable")
        pay.assert_not_called()
        self.assertEqual(patch_["last_error"], web.NO_CARD)

    def test_a_removed_card_falls_back_to_another(self):
        s = self.session([], cards=("other",))
        self.assertEqual(web.check_payable(s, "75005", "101", "FT630FH", "c"), "other")

    def accounts(self, *cards):
        s = MagicMock()
        rates = [{"ratePolicyId": "101", "name": "Résident", "type": "Resident"}]
        s.call.side_effect = lambda name, *a, **k: {"get_rate_options": rates,
                                                     "get_payment_accounts": {"paymentCards": list(cards)}}.get(name)
        return s

    def test_an_expired_card_is_not_used(self):
        old = {"paymentAccountId": "c", "cardType": "Visa", "maskedCardNumber": "1111", "expiryMonth": 1, "expiryYear": 2020}
        new = {"paymentAccountId": "n", "cardType": "Visa", "maskedCardNumber": "2222", "expiryMonth": 1, "expiryYear": 2099}
        self.assertEqual(web.check_payable(self.accounts(old, new), "75005", "101", "FT630FH", "c"), "n")
        with self.assertRaises(web.NotPayable) as refused:
            web.check_payable(self.accounts(old), "75005", "101", "FT630FH", "c")
        self.assertIn("exp. 01/20", str(refused.exception))

    def test_after_a_refusal_a_card_added_since_goes_first(self):
        old = {"paymentAccountId": "c", "cardType": "Visa", "maskedCardNumber": "1111", "expiryMonth": 1, "expiryYear": 2099}
        new = {"paymentAccountId": "n", "cardType": "Visa", "maskedCardNumber": "2222", "expiryMonth": 1, "expiryYear": 2099}
        self.assertEqual(web.check_payable(self.accounts(old, new), "75005", "101", "FT630FH", "c"), "c")  # still fine
        self.assertEqual(web.check_payable(self.accounts(old, new), "75005", "101", "FT630FH", "c", avoid=True), "n")
        self.assertEqual(web.check_payable(self.accounts(old), "75005", "101", "FT630FH", "c", avoid=True), "c")  # no other

    def test_a_card_is_valid_until_the_end_of_its_month(self):
        until = web.card_valid_until({"expiryMonth": 2, "expiryYear": 28})
        self.assertEqual((until.year, until.month, until.day), (2028, 2, 29))


if __name__ == "__main__":
    unittest.main()
