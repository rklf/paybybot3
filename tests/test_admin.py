import hashlib
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException, Response

from paybybot3 import web

SALT = bytes(16)
HASH = "pbkdf2_sha256$1000$%s$%s" % (SALT.hex(), hashlib.pbkdf2_hmac("sha256", b"a-test-password", SALT, 1000).hex())


class AdminAccess(unittest.TestCase):
    def setUp(self):
        self.patches = [
            patch.dict(os.environ, {"PAYBYBOT_SECRET": "t", "PAYBYBOT_ADMIN_EMAIL": "admin@example.com",
                                    "PAYBYBOT_ADMIN_PASSWORD_HASH": HASH}),
            patch.object(web, "HOSTED", True),
            patch.object(web, "store", return_value=True),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def login(self, email, password):
        response = Response()
        web.admin_login(web.AdminLogin(email=email, password=password), _Request(), response)
        return response.headers["set-cookie"].split("pbb_admin=")[1].split(";")[0]

    def test_right_credentials_open_the_stats(self):
        cookie = self.login("Admin@Example.com ", "a-test-password")
        web.admin_stats(cookie)  # no exception

    def test_wrong_password_or_email(self):
        for email, password in (("admin@example.com", "wrong"), ("other@example.com", "a-test-password")):
            with self.assertRaises(HTTPException) as e:
                self.login(email, password)
            self.assertEqual(e.exception.status_code, 401)

    def test_stats_need_the_admin_cookie(self):
        for cookie in (None, "forged"):
            with self.assertRaises(HTTPException) as e:
                web.admin_stats(cookie)
            self.assertEqual(e.exception.status_code, 401)


class _Request:
    headers = {"x-real-ip": "1.2.3.4"}


if __name__ == "__main__":
    unittest.main()


class CardDates(unittest.TestCase):
    def test_only_the_end_dates_of_cards(self):
        found = web.card_dates({"paymentCards": [
            {"cardType": "Visa", "maskedCardNumber": "****4242", "paymentAccountId": "a", "expiryMonth": 4, "expiryYear": 2099},
            {"cardType": "Visa", "maskedCardNumber": "****1111", "paymentAccountId": "b", "expiryMonth": 1, "expiryYear": 2020},
            {"cardType": "Visa", "maskedCardNumber": "****2222", "paymentAccountId": "c"}],
            "paypalAccounts": [{"paymentAccountId": "p"}]})
        self.assertEqual([(c["exp"], c["expired"]) for c in found], [("04/99", False), ("01/20", True), (None, False)])
        self.assertNotIn("4242", str(found))
