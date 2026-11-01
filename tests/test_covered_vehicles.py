import os
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from paybybot3 import web

NOW = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)
YEAR = int(web.MONTHLY_PRICE * (1 - web.YEARLY_DISCOUNT))  # 7,60 €: one month of the yearly offer


def ts(*a):
    return int(datetime(*a, tzinfo=timezone.utc).timestamp())


class MonthsLeft(unittest.TestCase):
    def test_the_month_started_counts_whole(self):
        self.assertEqual(web.months_left(NOW, datetime(2026, 11, 25, tzinfo=timezone.utc)), 1)

    def test_a_year_ahead(self):
        self.assertEqual(web.months_left(NOW, datetime(2027, 11, 25, tzinfo=timezone.utc)), 13)

    def test_a_whole_month(self):
        self.assertEqual(web.months_left(datetime(2026, 11, 25, tzinfo=timezone.utc),
                                         datetime(2026, 12, 25, tzinfo=timezone.utc)), 1)


class ChangeCents(unittest.TestCase):
    def test_monthly_adding_pays_the_month_started(self):
        self.assertEqual(web.change_cents("monthly", 1, added=1, removed=0), (web.MONTHLY_PRICE, 0))

    def test_yearly_adding_pays_every_month_left_with_the_discount(self):
        self.assertEqual(web.change_cents("yearly", 13, added=2, removed=0), (2 * 13 * YEAR, 0))

    def test_yearly_removing_keeps_the_month_started_and_credits_the_rest(self):
        self.assertEqual(web.change_cents("yearly", 13, added=0, removed=1), (0, 12 * YEAR))

    def test_monthly_removing_credits_nothing(self):
        self.assertEqual(web.change_cents("monthly", 1, added=0, removed=1), (0, 0))


VEHICLES = [{"plate": "AA111AA"}, {"plate": "BB222BB"}, {"plate": "CC333CC"}]


class Covered(unittest.TestCase):
    """« Mon compte »: the vehicles the subscription covers, changed by the client."""

    def setUp(self):
        self.env = patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def change(self, plates, confirm, status="active", interval="year", billed=("AA111AA",), renewed=(),
               pay_error=None, demo=False, account=None):
        s = MagicMock(demo=demo, username="u")
        calls, saved = [], {}

        def stripe(method, path, **data):
            calls.append((method, path, data))
            if method == "GET":
                return {"id": "sub_1", "status": status, "default_payment_method": "pm_1", "items": {"data": [{
                    "price": {"recurring": {"interval": interval}}, "current_period_end": ts(2027, 11, 25)}]}}
            if path == "invoices":
                return {"id": "in_1"}
            if path.endswith("/pay") and pay_error:
                raise HTTPException(502, "refused")
            return {}
        with patch.object(web, "current", return_value=s), patch.object(web, "HOSTED", True), \
                patch.object(web, "now_utc", return_value=NOW), \
                patch.object(web, "account_pricing", return_value={"vehicles": VEHICLES, "billed": list(billed)}), \
                patch.object(web, "load_account", return_value=account or {"stripe_subscription": "sub_1",
                                                                             "stripe_customer": "cus_1",
                                                                             "email": "client@test.fr"}), \
                patch.object(web, "save_account", side_effect=lambda _, p: saved.update(p) or p), \
                patch.object(web, "renewed_plates", return_value=set(renewed)), \
                patch.object(web, "stop_renewals") as stop, \
                patch.object(web, "send_email") as mail, \
                patch.object(web, "stripe", side_effect=stripe):
            answer = web.covered_vehicles(web.CoveredChange(plates=list(plates), confirm=confirm), pbb_session="c")
        self.mail = mail
        return answer, calls, saved, stop

    def test_the_preview_changes_nothing(self):
        answer, calls, saved, stop = self.change(["AA111AA", "BB222BB"], confirm=False)
        self.assertEqual(answer["chargeCents"], 13 * YEAR)
        self.assertEqual(answer["added"], ["BB222BB"])
        self.assertEqual([c for c in calls if c[0] == "POST"], [])
        self.assertEqual(saved, {})
        stop.assert_not_called()

    def test_adding_a_vehicle_is_charged_at_once(self):
        answer, calls, saved, _ = self.change(["AA111AA", "BB222BB"], confirm=True)
        item = next(c for c in calls if c[1] == "invoiceitems")
        self.assertEqual(item[2]["amount"], 13 * YEAR)
        self.assertIn(("POST", "invoices/in_1/pay", {}), calls)
        invoice = next(c for c in calls if c[1] == "invoices")
        self.assertEqual(invoice[2]["default_payment_method"], "pm_1")  # the subscription's card, not the customer's
        self.assertEqual(saved["chosen_plates"], ["AA111AA", "BB222BB"])

    def test_a_refused_charge_keeps_the_vehicles_as_they_were(self):
        with self.assertRaises(HTTPException) as e:
            self.change(["AA111AA", "BB222BB"], confirm=True, pay_error=True)
        self.assertEqual(e.exception.status_code, 402)

    def test_removing_a_renewed_vehicle_stops_its_renewal_and_credits_the_months_after(self):
        answer, calls, saved, stop = self.change(["AA111AA"], confirm=True, billed=("AA111AA", "BB222BB"),
                                                 renewed=("BB222BB",))
        stop.assert_called_once()
        self.assertEqual(stop.call_args.args[1], {"BB222BB"})
        credit = next(c for c in calls if c[1] == "invoiceitems")
        self.assertEqual(credit[2]["amount"], -12 * YEAR)
        self.assertNotIn(("POST", "invoices", ), [c[:2] for c in calls])
        self.assertEqual(saved["chosen_plates"], ["AA111AA"])

    def test_the_client_gets_an_email_with_the_new_subscription(self):
        self.change(["AA111AA", "BB222BB"], confirm=True)
        to, subject, title, lines = self.mail.call_args.args[:4]
        self.assertEqual(to, "client@test.fr")
        text = " ".join(lines)
        self.assertIn("BB222BB", text)
        self.assertIn("98,80", text)  # 13 months at 7,60 €
        self.assertIn("182,40", text)  # the new yearly subscription, two vehicles

    def test_a_preview_sends_no_email(self):
        self.change(["AA111AA", "BB222BB"], confirm=False)
        self.mail.assert_not_called()

    def test_the_last_vehicle_stays(self):
        with self.assertRaises(HTTPException) as e:
            self.change([], confirm=True)
        self.assertEqual(e.exception.status_code, 400)

    def test_during_paybybots_free_month_nothing_is_charged(self):
        # Stripe says « active » (first charge delayed to the end of the free month), PayByBot knows the free month.
        account = {"stripe_subscription": "sub_1", "stripe_customer": "cus_1",
                   "trial_start": web.utc_iso(NOW - web.timedelta(days=5))}
        answer, calls, saved, _ = self.change(["AA111AA", "BB222BB"], confirm=True, account=account)
        self.assertEqual(answer["chargeCents"], 0)
        self.assertEqual([c for c in calls if c[0] == "POST"], [])
        self.assertEqual(saved["chosen_plates"], ["AA111AA", "BB222BB"])

    def test_during_the_free_month_nothing_is_charged(self):
        answer, calls, saved, _ = self.change(["AA111AA", "BB222BB"], confirm=True, status="trialing")
        self.assertEqual(answer["chargeCents"], 0)
        self.assertEqual([c for c in calls if c[0] == "POST"], [])
        self.assertEqual(saved["chosen_plates"], ["AA111AA", "BB222BB"])


class OnlyCoveredVehicles(unittest.TestCase):
    """No renewal, programmed ticket or ticket from PayByBot for a vehicle the subscription does not cover."""

    def ensure(self, plate, status="active", account=None):
        s = MagicMock(demo=False, username="u")
        saved = {}
        sub = {"status": status, "items": {"data": [{"price": {"recurring": {"interval": "year"}},
                                                      "current_period_end": ts(2027, 11, 25)}]}}
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk"}), patch.object(web, "HOSTED", True), \
                patch.object(web, "now_utc", return_value=NOW), \
                patch.object(web, "account_pricing", return_value={"vehicles": VEHICLES, "billed": ["AA111AA"]}), \
                patch.object(web, "load_account", return_value=account or {"stripe_subscription": "sub_1"}), \
                patch.object(web, "save_account", side_effect=lambda _, p: saved.update(p) or p), \
                patch.object(web, "send_email") as mail, patch.object(web, "stripe", return_value=sub):
            web.ensure_covered(s, plate)
        self.mail = mail
        return saved

    def test_a_covered_vehicle_goes_through(self):
        self.assertEqual(self.ensure("AA-111-AA"), {})

    def test_an_uncovered_vehicle_is_refused_with_its_price(self):
        with self.assertRaises(HTTPException) as e:
            self.ensure("BB222BB")
        self.assertEqual(e.exception.status_code, 402)
        self.assertEqual(e.exception.detail["code"], "not_covered")
        self.assertEqual(e.exception.detail["cents"], 13 * YEAR)

    def test_during_paybybots_free_month_it_is_added_without_charge(self):
        saved = self.ensure("BB222BB", account={"stripe_subscription": "sub_1", "email": "client@test.fr",
                                                "trial_start": web.utc_iso(NOW - web.timedelta(days=5))})
        self.assertEqual(saved["chosen_plates"], ["AA111AA", "BB222BB"])
        self.assertEqual(self.mail.call_args.args[0], "client@test.fr")
        self.assertIn("mois offert", " ".join(self.mail.call_args.args[3]))

    def test_during_the_free_month_it_is_added_without_charge(self):
        saved = self.ensure("BB222BB", status="trialing")
        self.assertEqual(saved["chosen_plates"], ["AA111AA", "BB222BB"])

    def test_activating_a_renewal_checks_the_vehicle_first(self):
        s = MagicMock(demo=False, username="u", bot=MagicMock(refresh_token="t"))
        s.call.side_effect = lambda name, *a, **k: [{"licensePlate": "BB222BB"}] if name == "get_vehicles" else None
        body = web.Autopilot(label="", plate="BB222BB", location="75005", rate="101", duration=7, unit="Days",
                             paymentAccountId="c", email="a@b.fr")
        with patch.object(web, "current", return_value=s), patch.object(web, "HOSTED", True), \
                patch.object(web, "renewed_plates", return_value=set()), patch.object(web, "check_card"), \
                patch.object(web, "check_offer"), \
                patch.object(web, "ensure_covered", side_effect=HTTPException(402, "x")) as ensure, \
                patch.object(web, "store") as store:
            with self.assertRaises(HTTPException):
                web.add_autopilot(body, pbb_session="c")
        ensure.assert_called_once_with(s, "BB222BB")
        store.assert_not_called()

    def test_paying_a_ticket_checks_the_vehicle_first(self):
        s = MagicMock(demo=False, username="u", unconfirmed={})
        body = web.Parking(location="75005", rate="101", duration=1, unit="Hours", plate="BB222BB",
                           paymentAccountId="c")
        with patch.object(web, "current", return_value=s), patch.object(web, "HOSTED", True), \
                patch.object(web, "ensure_covered", side_effect=HTTPException(402, "x")), \
                patch.object(web, "pay_and_confirm") as paid:
            with self.assertRaises(HTTPException):
                web.pay(body, pbb_session="c")
        paid.assert_not_called()


if __name__ == "__main__":
    unittest.main()
