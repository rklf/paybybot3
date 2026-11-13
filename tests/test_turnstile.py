import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from paybybot3 import web

KEYS = {"TURNSTILE_SITE_KEY": "site", "TURNSTILE_SECRET_KEY": "secret"}


class _Request:
    headers = {"x-real-ip": "203.0.113.7"}


def answer(success):
    r = MagicMock()
    r.json.return_value = {"success": success, "error-codes": [] if success else ["invalid-input-response"]}
    return r


class HumanCheck(unittest.TestCase):
    def test_off_unless_hosted_with_both_keys(self):
        for hosted, env in ((False, KEYS), (True, {"TURNSTILE_SITE_KEY": "site"}), (True, {})):
            with patch.object(web, "HOSTED", hosted), patch.dict(os.environ, env, clear=True), \
                    patch.object(web.requests, "post") as post:
                self.assertEqual(web.turnstile_site_key(), "")
                web.check_human(_Request(), "")  # no exception, Cloudflare never called
                post.assert_not_called()

    def test_token_checked_with_cloudflare(self):
        with patch.object(web, "HOSTED", True), patch.dict(os.environ, KEYS), \
                patch.object(web.requests, "post", return_value=answer(True)) as post:
            self.assertEqual(web.turnstile_site_key(), "site")
            web.check_human(_Request(), "tok")
            self.assertEqual(post.call_args.args[0], web.TURNSTILE_VERIFY)
            self.assertEqual(post.call_args.kwargs["data"],
                             {"secret": "secret", "response": "tok", "remoteip": "203.0.113.7"})

    def test_missing_refused_or_unreachable(self):
        with patch.object(web, "HOSTED", True), patch.dict(os.environ, KEYS):
            for token, effect, status in (("", [answer(True)], 400), ("tok", [answer(False)], 400),
                                          ("tok", OSError, 503)):
                with patch.object(web.requests, "post", side_effect=effect):
                    with self.assertRaises(HTTPException) as e:
                        web.check_human(_Request(), token)
                    self.assertEqual(e.exception.status_code, status)

    def test_no_demo_on_the_public_site(self):
        with patch.object(web, "HOSTED", True), patch.dict(os.environ, {**KEYS, "PAYBYBOT_SECRET": "t"}), \
                patch.object(web, "check_human", side_effect=AssertionError) as check, \
                self.assertRaises(HTTPException) as refused:
            web.login(web.Login(username="demo", password="demo"), _Request(), web.Response())
        self.assertEqual(refused.exception.status_code, 404)
        check.assert_not_called()

    def test_login_and_admin_check_first(self):
        refused = HTTPException(400, "La vérification anti-robot a échoué. Réessayez.")
        with patch.object(web, "HOSTED", True), patch.dict(os.environ, {
                **KEYS, "PAYBYBOT_SECRET": "t", "PAYBYBOT_ADMIN_EMAIL": "a@b.fr", "PAYBYBOT_ADMIN_PASSWORD_HASH": "x"}), \
                patch.object(web, "check_human", side_effect=refused), \
                patch.object(web, "store", side_effect=AssertionError), \
                patch.object(web, "UserSession", side_effect=AssertionError):
            for call in (lambda: web.login(web.Login(username="+33612345678", password="p", accepted=True),
                                           _Request(), web.Response()),
                         lambda: web.admin_login(web.AdminLogin(email="a@b.fr", password="p"), _Request(),
                                                 web.Response())):
                with self.assertRaises(HTTPException) as e:
                    call()
                self.assertIs(e.exception, refused)


if __name__ == "__main__":
    unittest.main()
