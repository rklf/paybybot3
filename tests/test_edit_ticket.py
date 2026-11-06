"""A programmed ticket (non-resident) is edited in place: zone, rate, length, days, time, card; never its vehicle."""
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi import HTTPException

from paybybot3 import web
from paybybot3.schedule import PARIS, free_day


def body(**extra):
    fields = {"plate": "AB123CD", "location": "75017", "rate": "102", "duration": 2, "unit": "Hours",
              "paymentAccountId": "demo-card", "label": "Jours précis", "days": [0, 1, 2, 3, 4, 5], "start": "09:00"}
    return web.Autopilot(**{**fields, **extra})



def coming_paid_day():
    """Two days or more ahead, never a Paris Sunday or public holiday (no ticket is taken on those)."""
    day = datetime.now(PARIS).date() + timedelta(days=2)
    while free_day(day):
        day += timedelta(days=1)
    return day

class Demo(unittest.TestCase):
    def setUp(self):
        self.s = web.UserSession("demo", "", demo=True)
        self.s.autopilots["a1"] = {**body().model_dump(), "id": "a1", "enabled": True, "lastPayment": None,
                                   "lastError": "Paiement refusé.", "email": "x@example.com"}

    def edit(self, ap_id="a1", **extra):
        with patch.object(web, "current", return_value=self.s):
            return web.edit_autopilot(ap_id, body(**extra), "t")

    def test_the_rule_is_changed_in_place(self):
        ap = self.edit(location="75005", rate="103", duration=1, unit="Days", days=[1, 3], start="05:00")
        self.assertEqual(ap["id"], "a1")
        self.assertEqual((ap["location"], ap["rate"], ap["duration"], ap["unit"]), ("75005", "103", web.fmt_qty(1), "Days"))
        self.assertEqual((ap["days"], ap["start"]), ([1, 3], "05:00"))
        self.assertEqual(ap["email"], "x@example.com")  # kept
        self.assertIsNone(ap["lastError"])  # the old error was about the old settings
        self.assertIs(self.s.autopilots["a1"], ap)

    def test_a_calendar_period_is_kept_then_dropped(self):
        day = coming_paid_day().isoformat()
        ap = self.edit(days=list(range(7)), dateFrom=day)
        self.assertEqual((ap["dateFrom"], ap["dateTo"]), (day, day))
        ap = self.edit(days=[0, 1])
        self.assertEqual((ap["dateFrom"], ap["dateTo"]), (None, None))

    def test_the_vehicle_cannot_change(self):
        with self.assertRaises(HTTPException) as e:
            self.edit(plate="ZZ999ZZ")
        self.assertEqual(e.exception.status_code, 400)

    def test_only_programmed_tickets(self):
        with self.assertRaises(HTTPException) as e:
            self.edit(days=None)
        self.assertEqual(e.exception.status_code, 400)

    def test_unknown_ticket(self):
        with self.assertRaises(HTTPException) as e:
            self.edit("nope")
        self.assertEqual(e.exception.status_code, 404)


@patch.dict("os.environ", {"PAYBYBOT_SECRET": "t"})
class Hosted(unittest.TestCase):
    def test_new_settings_are_stored_encrypted_and_checked_soon(self):
        s = web.UserSession("demo", "", demo=True)
        s.demo, s.username = False, "0612345678"  # a real account, without logging in to PayByPhone
        old = {"label": "Jours précis", "plate": "AB123CD", "location": "75017", "rate": "102", "duration": "2",
               "unit": "Hours", "payment_account_id": "card-1", "email": "x@example.com", "days": [0, 1],
               "start": "09:00", "cmis_attested_at": ""}
        row = {"id": "r1", "enabled": True, "data": web.encrypt_details(old)}
        calls = {}

        def store(fn, **p):
            if fn == "renewal_list":
                return [row]
            calls[fn] = p
            return {**row, "data": p["p_patch"]["data"]}

        cards = {"paymentAccounts": [{"id": "card-1", "paymentMethodType": "PaymentCard"}]}
        with patch.object(web, "HOSTED", True), patch.object(web, "current", return_value=s), \
                patch.object(web, "store", side_effect=store), patch.object(web, "load_account", return_value={}), \
                patch.object(web, "billing_state", return_value="ok"), \
                patch.object(web, "normalize_accounts", return_value=[{"id": "card-1", "kind": "card"}]), \
                patch.object(s, "call", return_value=cards):
            ap = web.edit_autopilot("r1", body(location="75005", rate="103", duration=1, unit="Days",
                                               paymentAccountId="card-1", days=[2], start="05:00", cmis=True), "t")
        patch_sent = calls["renewal_update_owned"]["p_patch"]
        stored = web.with_details({"data": patch_sent["data"]})
        self.assertEqual((stored["location"], stored["rate"], stored["unit"], stored["days"], stored["start"]),
                         ("75005", "103", "Days", [2], "05:00"))
        self.assertEqual(stored["email"], "x@example.com")
        self.assertTrue(stored["cmis_attested_at"])
        self.assertIn("next_check", patch_sent)
        self.assertIsNone(patch_sent["last_error"])
        self.assertEqual(ap["location"], "75005")

    def test_no_change_without_an_offer(self):
        s = web.UserSession("demo", "", demo=True)
        s.demo, s.username = False, "0612345678"
        old = {"plate": "AB123CD", "location": "75017", "rate": "102", "duration": "2", "unit": "Hours",
               "payment_account_id": "card-1", "days": [0, 1], "start": "09:00"}
        rows = [{"id": "r1", "enabled": True, "data": web.encrypt_details(old)}]
        for state in ("trial", "trial_over", "unpaid"):
            with self.subTest(state=state), patch.object(web, "HOSTED", True), \
                    patch.object(web, "current", return_value=s), \
                    patch.object(web, "store", return_value=rows), patch.object(web, "load_account", return_value={}), \
                    patch.object(web, "billing_state", return_value=state), \
                    patch.object(web, "update_own_renewal") as update:
                with self.assertRaises(HTTPException) as e:
                    web.edit_autopilot("r1", body(paymentAccountId="card-1"), "t")
                self.assertEqual(e.exception.status_code, 402)
                update.assert_not_called()


if __name__ == "__main__":
    unittest.main()
