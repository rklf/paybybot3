import unittest
from unittest.mock import patch

from fastapi import HTTPException, Response

from paybybot3 import web


class Account(unittest.TestCase):
    def setUp(self):
        self.s = web.UserSession("demo", "", demo=True)
        self.s.demo = False  # behave like a real local account (no e-mail is sent in demo)
        self.current = patch.object(web, "current", return_value=self.s)
        self.current.start()

    def tearDown(self):
        self.current.stop()

    def test_the_zone_cannot_be_typed(self):
        web.update_account(web.AccountPatch(zone="75017"), "t")  # ignored: it comes from PayByPhone
        self.assertNotIn("zone", self.s.account)

    def test_free_month_starts_when_the_offer_is_chosen_and_lasts_30_days(self):
        from datetime import datetime
        web.update_account(web.AccountPatch(email="a@b.fr"), "t")
        account = web.get_account("t")  # no offer chosen yet: not started, 30 days promised
        self.assertIsNone(account["trialEnd"])
        self.assertEqual(account["trialDays"], 30)
        with patch.dict("os.environ", {"PAYBYBOT_SECRET": "t"}):
            session = {"client_reference_id": web.owner_id(self.s.username), "status": "complete",
                       "metadata": {"plan": "monthly"}, "customer": "cus_1", "subscription": "sub_1"}
            with patch.object(web, "stripe", return_value=session):
                web.billing_confirm(web.CheckoutDone(session_id="cs_test_1234567890"), "t")
        start = datetime.fromisoformat(self.s.account["trial_start"])
        self.assertLess((datetime.now(start.tzinfo) - start).total_seconds(), 60)  # started on payment
        with patch.object(web, "billing_status", return_value=("ok", None)):
            account = web.get_account("t")
        self.assertEqual((datetime.fromisoformat(account["trialEnd"]) - start).days, 30)
        self.assertIsNone(account["trialDays"])

    def test_an_old_sign_up_start_without_an_offer_is_reset(self):
        self.s.account = {"email": "a@b.fr", "trial_start": "2026-10-01T10:00:00+00:00"}
        self.assertIsNone(web.get_account("t")["trialEnd"])
        self.s.account["trial_start"] = "2026-10-01T10:00:00+00:00"  # a kept start (earlier free month): stays
        self.assertIsNotNone(web.get_account("t")["trialEnd"])

    def test_deleting_sends_a_confirmation_and_erases(self):
        web.update_account(web.AccountPatch(email="a@b.fr"), "t")
        with patch.object(web, "send_email") as send:
            web.delete_my_data(Response(), "t")
        self.assertEqual(send.call_args.args[0], "a@b.fr")
        self.assertEqual(self.s.account, {})

    def test_sign_up_needs_an_email_not_an_address(self):
        with self.assertRaises(HTTPException) as e:
            web.login(web.Login(username="+33612345678", password="x", signup=True), None, Response())
        self.assertIn("e-mail", e.exception.detail)

    def test_sign_up_refused_when_the_account_exists(self):
        web.update_account(web.AccountPatch(email="a@b.fr"), "t")
        self.assertTrue(web.has_account(self.s))
        with patch.object(web, "UserSession", return_value=self.s), self.assertRaises(HTTPException) as e:
            web.login(web.Login(username="+33612345678", password="x", signup=True, email="c@d.fr", zone="75017"),
                      None, Response())
        self.assertEqual(e.exception.status_code, 409)

    def sign_up(self):
        fresh = web.UserSession("demo", "", demo=True)
        fresh.demo = False
        codes, response = [], Response()
        with patch.object(web, "UserSession", return_value=fresh), \
                patch.object(web, "send_code", side_effect=lambda email, code: codes.append(code)):
            result = web.login(web.Login(username="+33612345678", password="x", signup=True, email="c@d.fr",
                                         zone="75017"), None, response)
        token = response.headers["set-cookie"].split("pbb_pending=")[1].split(";")[0]
        return fresh, result, codes[0], token

    def test_sign_up_without_a_saved_card_still_creates_the_account(self):
        # The account then shows « Carte bancaire requise » full screen until a card is added on PayByPhone.
        fresh = web.UserSession("demo", "", demo=True)
        fresh.demo = False
        fresh.bot.get_payment_accounts = lambda: {"paymentCards": [], "paypalAccounts": []}  # e.g. Apple Pay only
        with patch.object(web, "UserSession", return_value=fresh), patch.object(web, "send_code") as sent:
            result = web.login(web.Login(username="+33612345678", password="x", signup=True, email="c@d.fr"), None,
                               Response())
        self.assertTrue(result["pending"])
        sent.assert_called_once()

    def test_sign_up_waits_for_the_code(self):
        fresh, result, code, token = self.sign_up()
        self.assertTrue(result["pending"])
        self.assertEqual(result["email"], "c•••@d.fr")
        self.assertEqual(fresh.account, {})  # nothing created before the code
        web.verify_signup(web.CodeCheck(code=code[:3] + " " + code[3:]), Response(), token)
        # The zone comes from PayByPhone (the demo offers the resident rate everywhere: the 1st), not the form.
        self.assertEqual({k: fresh.account[k] for k in ("email", "zone", "zone_found")},
                         {"email": "c@d.fr", "zone": "75001", "zone_found": True})
        self.assertNotIn("trial_start", fresh.account)  # the free month starts with the offer, not at sign-up

    def test_wrong_code_then_too_many_tries(self):
        _, _, code, token = self.sign_up()
        wrong = "%06d" % ((int(code) + 1) % 10 ** 6)
        for _ in range(web.CODE_TRIES):
            with self.assertRaises(HTTPException) as e:
                web.verify_signup(web.CodeCheck(code=wrong), Response(), token)
            self.assertEqual(e.exception.status_code, 400)
        with self.assertRaises(HTTPException) as e:  # even the right code is refused now
            web.verify_signup(web.CodeCheck(code=code), Response(), token)
        self.assertEqual(e.exception.status_code, 429)


class HostedLogin(unittest.TestCase):
    def test_login_without_account_is_refused_online(self):
        s = web.UserSession("demo", "", demo=True)
        s.demo = False
        with patch.object(web, "HOSTED", True), patch.object(web, "UserSession", return_value=s), \
                patch.object(web, "has_account", return_value=False), patch.object(web, "check_login_rate"), \
                self.assertRaises(HTTPException) as e:
            web.login(web.Login(username="+33612345678", password="x", accepted=True), None, Response())
        self.assertEqual(e.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
