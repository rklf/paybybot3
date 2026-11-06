import json
import time
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from paybybot3 import web


def user(demo=False):
    return SimpleNamespace(demo=demo, username="0612345678")


class Activity(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"PAYBYBOT_SECRET": "s" * 40})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def record(self, s=None, hosted=True):
        calls = []
        with patch.object(web, "HOSTED", hosted), \
                patch.object(web, "store", side_effect=lambda fn, **k: calls.append((fn, k))), \
                patch.object(web, "load_account", return_value={"email": "julie@gmail.com"}), \
                patch.object(web, "first_name", return_value="Julie"):
            web.record_activity("Connexion", s if s is not None else user(), ["Véhicule AB***."])
        return calls

    def test_an_action_is_recorded_encrypted_with_who_did_it(self):
        (fn, k), = self.record()
        self.assertEqual((fn, k["p_event"]), ("activity_add", "Connexion"))
        self.assertNotIn("julie", k["p_data"])  # encrypted
        with patch.object(web, "store", return_value=[{"at": "2026-10-28T09:00:00Z", "event": "Connexion",
                                                        "data": k["p_data"]}]):
            self.assertEqual(web.activity_rows(), [{"id": None, "at": "2026-10-28T09:00:00Z", "event": "Connexion",
                                                    "who": "Julie · julie@gmail.com", "detail": "Véhicule AB***.",
                                                    "visitor": None}])

    def test_no_e_mail(self):
        with patch.object(web, "send_email") as mail:
            self.record()
        mail.assert_not_called()

    def test_not_for_the_demo_nor_locally(self):
        self.assertEqual(self.record(s=user(demo=True)), [])
        self.assertEqual(self.record(hosted=False), [])

    def test_not_for_the_owners_own_accounts(self):
        with patch.object(web, "is_admin", return_value=True):
            self.assertEqual(self.record(), [])

    def test_never_raises(self):
        with patch.object(web, "HOSTED", True), patch.object(web, "store", side_effect=RuntimeError("down")):
            web.record_activity("Connexion", user())


class LinkVisitor(unittest.TestCase):
    """Each device sends a random id with the link it opens: « Activité » groups the visits of one visitor."""

    def setUp(self):
        self.env = patch.dict(os.environ, {"PAYBYBOT_SECRET": "s" * 40})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def request(self):
        return SimpleNamespace(headers={"x-vercel-ip-city": "Paris", "x-vercel-ip-country": "FR"})

    def test_the_visitor_id_is_kept_encrypted_and_read_back(self):
        calls = []
        with patch.object(web, "HOSTED", True), \
                patch.object(web, "store", side_effect=lambda fn, **k: calls.append((fn, k)) or 7):
            web.link_open(web.LinkOpen(source="Direct", device="Ordinateur", visit=3, visitor="a1b2c3d4e5f6"),
                          self.request())
            web.link_progress(web.LinkProgress(id=7, sig=web.link_sig(7), source="Direct", device="Ordinateur",
                                               visit=3, visitor="a1b2c3d4e5f6", seconds=40), self.request())
        (_, opened), (_, progressed) = [c for c in calls if c[0] != "rate_hit"]
        for data in (opened["p_data"], progressed["p_data"]):
            self.assertNotIn("a1b2c3d4e5f6", data)
            with patch.object(web, "store", return_value=[{"id": 7, "at": "t", "event": "Lien privé ouvert",
                                                            "data": data}]):
                self.assertEqual(web.activity_rows()[0]["visitor"], "a1b2c3d4e5f6")

    def test_a_burst_of_opened_links_is_not_recorded(self):
        calls = []
        store = lambda fn, **k: calls.append(fn) or (False if fn == "rate_hit" else 7)
        with patch.object(web, "HOSTED", True), patch.object(web, "store", side_effect=store):
            answer = web.link_open(web.LinkOpen(source="Direct"), self.request())
        self.assertEqual(answer, {"id": None, "sig": None})
        self.assertEqual(calls, ["rate_hit"])

    def test_an_odd_visitor_id_is_refused(self):
        with self.assertRaises(Exception):
            web.LinkOpen(visitor="<script>")


if __name__ == "__main__":
    unittest.main()


class LoginRateKey(unittest.TestCase):
    """The same number typed two ways shares one count of login attempts."""

    def test_formats_of_one_number_share_the_count(self):
        keys = []
        req = SimpleNamespace(headers={"x-real-ip": "1.2.3.4"})
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "s" * 40}), \
                patch.object(web, "store", side_effect=lambda fn, **k: keys.append(k["p_key"]) or True):
            for typed in ("06 12 34 56 78", "+33612345678", "06.12.34.56.78"):
                web.check_login_rate(req, typed)
        self.assertEqual(len({k for k in keys if k.startswith("user:")}), 1)


class UnlockLink(unittest.TestCase):
    """The e-mail's unlock link never opens the Stripe portal (card, cancellation) for whoever holds it."""

    def test_no_portal_without_a_session(self):
        answers = {"subscriptions/sub": {"status": "unpaid", "latest_invoice": None}}
        with patch.object(web, "stripe", side_effect=lambda method, path, **k: answers.get(path) or {"url": "portal"}):
            url = web.unlock_url("o", {"stripe_subscription": "sub", "stripe_customer": "c"}, portal=False)
        self.assertTrue(url.endswith("/#/connexion"))


class Resubscribed(unittest.TestCase):
    """Paid again after a cancellation, the return page missed: the new subscription is found, not « trial_over »."""

    def test_a_cancelled_subscription_does_not_hide_the_new_one(self):
        account = {"stripe_subscription": "old", "checkout_at": 1, "trial_start": "2020-01-01T00:00:00+00:00"}
        answers = {"subscriptions/old?expand[]=latest_invoice": {"status": "canceled"}}
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk"}), \
                patch.object(web, "stripe", side_effect=lambda m, path, **k: answers.get(path, {})), \
                patch.object(web, "recover_subscription", return_value=True) as recover:
            self.assertEqual(web.billing_status(account, "owner")[0], "ok")
        recover.assert_called_once()


class LogoutRevokes(unittest.TestCase):
    """After « Déconnexion », the same cookie (copied elsewhere) opens nothing; a new login works."""

    def test_a_logged_out_cookie_is_refused(self):
        accounts = {}
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "s" * 40}), patch.object(web, "HOSTED", True), \
                patch.object(web, "account_by_owner", side_effect=lambda o: dict(accounts.get(o, {"email": "x@y.fr"}))), \
                patch.object(web, "save_account_by_owner",
                             side_effect=lambda o, p: accounts.setdefault(o, {"email": "x@y.fr"}).update(p)):
            web._REVOKED.clear()
            s = web.UserSession.from_state({"u": "+33612345678", "d": False, "t": "a", "r": "b",
                                            "iat": int(time.time()) - 5})
            cookie = web.seal(s)
            self.assertEqual(web.current(cookie).username, "+33612345678")
            web.logout(web.Response(), cookie)
            with self.assertRaises(web.HTTPException):
                web.current(cookie)
            fresh = web.UserSession.from_state({"u": "+33612345678", "d": False, "t": "a", "r": "b",
                                                "iat": 0})
            fresh.issued_at = int(time.time()) + 1  # a new login: a later time
            self.assertEqual(web.current(web.seal(fresh)).username, "+33612345678")
