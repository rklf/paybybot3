import os
import time
import unittest
from unittest.mock import patch

from fastapi import HTTPException, Response

from paybybot3 import web


class RememberMe(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"PAYBYBOT_SECRET": "test-secret"})
        self.env.start()
        self.hosted = patch.object(web, "HOSTED", True)
        self.hosted.start()

    def tearDown(self):
        self.hosted.stop()
        self.env.stop()

    def token(self, remember, age):
        s = web.UserSession("demo", "", demo=True)
        s.remember = remember
        s.issued_at = int(time.time()) - age
        with patch("time.time", return_value=time.time() - age):  # sealed `age` seconds ago
            return web.seal(s)

    def test_a_day_old_login_needs_remember_me(self):
        two_days = 2 * 24 * 3600
        with self.assertRaises(HTTPException):
            web.current(self.token(False, two_days))
        self.assertTrue(web.current(self.token(True, two_days)).remember)

    def test_remember_me_ends_after_30_days(self):
        with self.assertRaises(HTTPException):
            web.current(self.token(True, 31 * 24 * 3600))

    def test_cookie_is_persistent_only_with_remember_me(self):
        r = Response()
        web.set_session_cookie(r, "x", remember=True)
        self.assertIn("Max-Age=%d" % web.REMEMBER, r.headers["set-cookie"])
        r = Response()
        web.set_session_cookie(r, "x")
        self.assertNotIn("Max-Age", r.headers["set-cookie"])


class AdminLogin(unittest.TestCase):
    def test_admin_logs_in_without_account(self):
        s = web.UserSession("demo", "", demo=True)
        s.demo, s.username = False, "+33777920788"
        s.bot.authorization, s.bot.refresh_token = "Bearer x", None
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t", "PAYBYBOT_ADMINS": "0777920788"}), \
                patch.object(web, "HOSTED", True), patch.object(web, "UserSession", return_value=s), \
                patch.object(web, "has_account", return_value=False), patch.object(web, "check_login_rate"), \
                patch.object(web, "store"):
            me = web.login(web.Login(username="+33777920788", password="x", accepted=True), None, Response())
        self.assertEqual(me["username"], "+33777920788")


if __name__ == "__main__":
    unittest.main()
