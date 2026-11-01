import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from paybybot3 import web

ENV = {"PAYBYBOT_SECRET": "s" * 40}


def later(**k):
    return datetime.now(timezone.utc) + timedelta(**k)


class Rebill(unittest.TestCase):
    def rebill(self, account, now=None):
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk"}), \
                patch.object(web, "account_by_owner", return_value=account), \
                patch.object(web, "stripe") as stripe:
            web.rebill_backup({"id": "r", "owner": "o"}, {"cost": {"amount": 9.0, "currency": "EUR"}}, now)
        return stripe

    def test_a_ticket_paid_on_the_backup_is_added_to_the_next_invoice(self):
        stripe = self.rebill({"stripe_customer": "cus_1"})
        item = stripe.call_args_list[0]
        self.assertEqual(item.args[:2], ("POST", "invoiceitems"))
        self.assertEqual(item.kwargs["customer"], "cus_1")
        self.assertEqual(item.kwargs["amount"], 900)
        self.assertEqual(item.kwargs["currency"], "eur")

    def test_the_invoice_line_gives_the_tickets_date(self):
        stripe = self.rebill({"stripe_customer": "cus_1"}, datetime(2026, 11, 5, 19, 30, tzinfo=timezone.utc))
        self.assertIn("5 novembre 2026", stripe.call_args_list[0].kwargs["description"])

    def test_no_customer_means_nothing_is_billed(self):
        self.rebill({}).assert_not_called()

    def test_a_yearly_client_is_billed_the_advances_every_month(self):
        stripe = self.rebill({"stripe_customer": "cus_1", "plan": "yearly", "stripe_subscription": "sub_1"})
        self.assertIn((("POST", "subscriptions/sub_1"), {"pending_invoice_item_interval[interval]": "month"}),
                      [(c.args, c.kwargs) for c in stripe.call_args_list])

    def test_a_monthly_client_keeps_the_usual_invoice(self):
        stripe = self.rebill({"stripe_customer": "cus_1", "plan": "monthly", "stripe_subscription": "sub_1"})
        self.assertEqual(len(stripe.call_args_list), 1)


ROW = {"id": "r1", "owner": "o", "plate": "FT630FH", "location": "75005", "rate": "101", "duration": 7, "unit": "Days"}


class Advance(unittest.TestCase):
    """The owner's own PayByPhone account pays the client's ticket, for the client's plate."""

    def run_advance(self, backup=None, state="ok", spend=True, pay=None):
        backup = {"credential": "enc", "label": "06•••78"} if backup is None else backup
        calls = []

        def store(fn, **k):
            calls.append((fn, k))
            return {"backup_account_get": backup, "backup_spend": spend}.get(fn)
        session = MagicMock()
        session.call.side_effect = lambda name, *a, **k: {
            "_create_quote": {"cost": {"amount": 9.0, "currency": "EUR"}}}.get(name)
        with patch.object(web, "store", side_effect=store), \
                patch.object(web, "decrypt_credential", return_value="refresh"), \
                patch.object(web.Bot, "from_refresh_token", return_value=MagicMock(refresh_token="refresh")), \
                patch.object(web.UserSession, "for_bot", return_value=session), \
                patch.object(web, "account_by_owner", return_value={"stripe_customer": "cus_1"}), \
                patch.object(web, "billing_state", return_value=state), \
                patch.object(web, "check_payable", return_value="backupcard") as check, \
                patch.object(web, "pay_and_confirm", side_effect=pay,
                             return_value=({"cost": {"amount": 9.0}}, [{"expireTime": later(days=7)}])) as paid, \
                patch.object(web, "rebill_backup") as rebill:
            answer = web.advance(ROW, later())
        return answer, paid, rebill, check, calls

    def test_no_backup_account_pays_nothing(self):
        answer, paid, rebill, _, _ = self.run_advance(backup={})
        self.assertIsNone(answer)
        paid.assert_not_called()
        rebill.assert_not_called()

    def test_a_client_with_an_unpaid_invoice_gets_no_advance(self):
        answer, paid, _, _, _ = self.run_advance(state="grace")
        self.assertIsNone(answer)
        paid.assert_not_called()

    def test_the_weekly_cap_stops_the_advances(self):
        answer, paid, _, _, _ = self.run_advance(spend=False)
        self.assertIsNone(answer)
        paid.assert_not_called()

    def test_pays_the_clients_plate_and_rate_from_the_backup_account(self):
        answer, paid, rebill, check, calls = self.run_advance()
        self.assertIsNotNone(answer)
        self.assertEqual(check.call_args.args[1:4], ("75005", "101", "FT630FH"))
        self.assertEqual(paid.call_args.args[1:], ("75005", "101", web.fmt_qty(7), "Days", "FT630FH", "backupcard"))
        self.assertIn(("backup_spend", {"p_cents": 900, "p_cap": web.BACKUP_WEEKLY_CAP_CENTS}), calls)
        rebill.assert_called_once()

    def test_a_refused_advance_gives_the_budget_back(self):
        answer, _, rebill, _, calls = self.run_advance(pay=RuntimeError("Payment job failed: x"))
        self.assertIsNone(answer)
        rebill.assert_not_called()
        self.assertIn(("backup_spend", {"p_cents": -900, "p_cap": web.BACKUP_WEEKLY_CAP_CENTS}), calls)


class Renewal(unittest.TestCase):
    """When the client's card fails and nothing covers the car, the renewal falls back on the advance."""

    def setUp(self):
        self.env = patch.dict(os.environ, ENV)
        self.env.start()
        self.addCleanup(self.env.stop)

    def session(self, tickets):
        answers = {"get_parking_sessions": tickets,
                   "get_rate_options": [{"ratePolicyId": "101", "name": "Résident", "type": "Resident"}],
                   "get_payment_accounts": {"paymentCards": [{"paymentAccountId": "c"}]}}
        s = MagicMock()
        s.call.side_effect = lambda name, *a, **k: answers.get(name)
        return s

    def run_renewal(self, tickets=(), pay_error=None, advanced=None, check_error=None, last_error=None, **details):
        row = {**ROW, "payment_account_id": "c", "last_error": last_error, "enabled": True, "email": "a@b.c",
               **details}
        stored = []
        expire = later(days=7)
        with patch.object(web, "with_details", side_effect=lambda r: r), \
                patch.object(web, "guarded_state", return_value="ok"), \
                patch.object(web, "store", side_effect=lambda *a, **k: stored.append(k)), \
                patch.object(web, "notify") as mail, patch.object(web, "notify_bank"), \
                patch.object(web.Bot, "from_refresh_token", return_value=MagicMock(refresh_token="t")), \
                patch.object(web.UserSession, "for_bot", return_value=self.session(list(tickets))), \
                patch.object(web, "check_payable", side_effect=check_error, return_value="c"), \
                patch.object(web, "pay_and_confirm", side_effect=pay_error or AssertionError("must not pay")), \
                patch.object(web, "count_card"), \
                patch.object(web, "advance", return_value=advanced and ({"cost": {"amount": 9.0}},
                                                                       [{"expireTime": expire}])) as adv:
            outcome = web.process_renewal(row, refresh_token="t")
        return outcome, stored[-1]["p_patch"], mail, adv, expire

    def details(self, p):
        return json.loads(web._fernet("renewal").decrypt(p["data"].encode()))

    def test_a_declined_card_with_no_ticket_is_advanced(self):
        outcome, p, mail, adv, expire = self.run_renewal(pay_error=RuntimeError("Payment job failed: declined"),
                                                         advanced=True)
        self.assertEqual(outcome, "advanced")
        adv.assert_called_once()
        self.assertIsNone(p["last_error"])
        self.assertEqual(web.parse_dt(p["next_check"]), expire + timedelta(seconds=30))
        self.assertEqual(web.parse_dt(self.details(p)["advanced_until"]), expire)
        self.assertEqual(mail.call_args.args[1], "advanced")

    def test_without_an_advance_the_refusal_is_handled_as_before(self):
        outcome, p, _, adv, _ = self.run_renewal(pay_error=RuntimeError("Payment job failed: declined"),
                                                 advanced=False)
        self.assertEqual(outcome, "refused")
        adv.assert_called_once()
        self.assertTrue(p["last_error"])

    def test_an_unconfirmed_payment_is_never_advanced(self):  # it may have gone through: no double payment
        outcome, _, _, adv, _ = self.run_renewal(pay_error=web.Unconfirmed("?"), advanced=True)
        self.assertEqual(outcome, "unconfirmed")
        adv.assert_not_called()

    def test_no_card_left_is_advanced(self):
        outcome, _, _, adv, _ = self.run_renewal(check_error=web.NotPayable(web.NO_CARD), advanced=True)
        self.assertEqual(outcome, "advanced")
        adv.assert_called_once()

    def test_a_resident_right_ended_is_not_advanced(self):
        outcome, _, _, adv, _ = self.run_renewal(check_error=web.NotPayable(web.RESIDENT_REFUSED % ""),
                                                 advanced=True)
        self.assertEqual(outcome, "not_payable")
        adv.assert_not_called()

    def test_an_advanced_ticket_is_not_paid_again(self):
        outcome, p, _, adv, _ = self.run_renewal(advanced_until=web.utc_iso(later(days=3)))
        self.assertEqual(outcome, "active")
        adv.assert_not_called()
        self.assertTrue(later(days=2) < web.parse_dt(p["next_check"]) < later(days=4))

    def test_a_bank_validation_never_given_is_advanced(self):
        outcome, p, _, adv, _ = self.run_renewal(last_error=web.BANK_WAIT, advanced=True,
                                                 bank_deadline=web.utc_iso(later(minutes=-1)))
        self.assertEqual(outcome, "advanced")
        self.assertNotIn("enabled", p)


class AdminAccount(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, ENV)
        self.env.start()
        self.addCleanup(self.env.stop)

    def connect(self, cards):
        bot = MagicMock(refresh_token="refresh")
        bot.get_payment_accounts.return_value = {"paymentCards": cards}
        with patch.object(web, "HOSTED", True), patch.object(web, "require_admin"), \
                patch.object(web, "connect", return_value=(bot, "+33612345678")), \
                patch.object(web, "store") as store:
            answer = web.admin_backup_account_set(web.BackupAccount(login="0612345678", password="pw"), pbb_admin="x")
        return answer, store

    def test_connecting_keeps_the_login_encrypted_and_shows_the_card(self):
        answer, store = self.connect([{"paymentAccountId": "b", "cardType": "Visa", "maskedCardNumber": "**9385",
                                       "expiryMonth": 7, "expiryYear": 2031}])
        fn, kwargs = store.call_args.args[0], store.call_args.kwargs
        self.assertEqual(fn, "backup_account_set")
        self.assertEqual(web.decrypt_credential(kwargs["p_credential"]), "refresh")
        self.assertNotIn("pw", json.dumps(kwargs))
        self.assertIn("9385", answer["cards"][0])
        self.assertTrue(answer["connected"])

    def test_an_account_without_a_card_is_refused(self):
        with self.assertRaises(HTTPException):
            self.connect([])

    def test_disconnecting_forgets_the_account(self):
        with patch.object(web, "HOSTED", True), patch.object(web, "require_admin"), \
                patch.object(web, "store") as store:
            web.admin_backup_account_delete(pbb_admin="x")
        store.assert_called_once_with("backup_account_set", p_credential=None, p_label=None)

    def test_the_status_counts_this_weeks_advances(self):
        state = {"credential": "enc", "label": "06•••78", "week_start": web.utc_iso(later(days=-2)), "week_cents": 1800}
        with patch.object(web, "HOSTED", True), patch.object(web, "require_admin"), \
                patch.object(web, "store", return_value=state):
            answer = web.admin_backup_account(pbb_admin="x")
        self.assertEqual(answer, {"connected": True, "label": "06•••78", "weekCents": 1800,
                                  "capCents": web.BACKUP_WEEKLY_CAP_CENTS})




class NeverGivesUp(unittest.TestCase):
    """With a backup account, an activated renewal is never stopped for a card: the advance takes over each time."""

    def setUp(self):
        self.env = patch.dict(os.environ, ENV)
        self.env.start()
        self.addCleanup(self.env.stop)

    def refused(self, message, ready, ends=None, tries=3):
        row = {**ROW, "refused_tries": tries}
        with patch.object(web, "backup_ready", return_value=ready):
            return web.refused_patch(row, message, message, later(), ends)

    def test_without_backup_the_last_refusal_suspends(self):
        self.assertIs(self.refused("refusée", ready=False)["enabled"], False)

    def test_with_backup_a_refusal_waits_for_the_ticket_end_to_advance(self):
        ends = later(hours=20)
        patch_ = self.refused("refusée", ready=True, ends=ends)
        self.assertNotIn("enabled", patch_)
        self.assertEqual(web.parse_dt(patch_["next_check"]), ends + timedelta(seconds=30))

    def test_with_backup_and_no_ticket_it_keeps_trying(self):
        patch_ = self.refused("refusée", ready=True)
        self.assertNotIn("enabled", patch_)
        self.assertTrue(later(hours=7) < web.parse_dt(patch_["next_check"]) < later(hours=9))

    def test_an_unconfirmed_payment_still_suspends(self):  # it may have gone through: never paid again blindly
        self.assertIs(self.refused(web.UNCONFIRMED, ready=True)["enabled"], False)

    def test_a_validation_never_given_does_not_suspend_when_the_advance_fails(self):
        row = {**ROW, "payment_account_id": "c", "last_error": web.BANK_WAIT, "enabled": True, "email": "a@b.fr",
               "bank_deadline": web.utc_iso(later(minutes=-1))}
        stored = []
        s = MagicMock()
        s.call.side_effect = lambda name, *a, **k: {"get_parking_sessions": []}.get(name)
        with patch.object(web, "with_details", side_effect=lambda r: r), \
                patch.object(web, "guarded_state", return_value="ok"), \
                patch.object(web, "store", side_effect=lambda *a, **k: stored.append(k)), \
                patch.object(web, "notify"), patch.object(web, "notify_bank"), patch.object(web, "count_card"), \
                patch.object(web.Bot, "from_refresh_token", return_value=MagicMock(refresh_token="t")), \
                patch.object(web.UserSession, "for_bot", return_value=s), \
                patch.object(web, "backup_ready", return_value=True), \
                patch.object(web, "advance", return_value=None):
            web.process_renewal(row, refresh_token="t")
        p = stored[-1]["p_patch"]
        self.assertNotIn("enabled", p)
        self.assertTrue(later(minutes=50) < web.parse_dt(p["next_check"]) < later(minutes=70))


if __name__ == "__main__":
    unittest.main()
