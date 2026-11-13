import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from paybybot3 import web


class EmailUnique(unittest.TestCase):
    def test_the_same_person_s_address_whatever_its_spelling(self):
        self.assertEqual(web.email_key("Jean.Dupont+pbb@gmail.com"), web.email_key("jeandupont@googlemail.com"))
        self.assertNotEqual(web.email_key("a@orange.fr"), web.email_key("b@orange.fr"))

    def test_taken_by_another_account_only(self):
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "HOSTED", True), \
                patch.object(web, "store", return_value="owner-1"):
            self.assertTrue(web.email_taken("a@b.fr", "owner-2"))
            self.assertFalse(web.email_taken("a@b.fr", "owner-1"))  # its own address
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "HOSTED", True), \
                patch.object(web, "store", return_value=None):
            self.assertFalse(web.email_taken("a@b.fr", "owner-2"))

    def test_a_failed_lookup_never_blocks(self):
        with patch.object(web, "HOSTED", True), patch.object(web, "store", side_effect=RuntimeError("down")):
            self.assertFalse(web.email_taken("a@b.fr", "owner-2"))

    def test_changing_to_a_taken_address_is_refused(self):
        s = type("S", (), {"username": "0611223344", "demo": False})()
        with patch.object(web, "current", return_value=s), patch.object(web, "email_taken", return_value=True), \
                self.assertRaises(HTTPException) as e:
            web.update_account(web.AccountPatch(email="a@b.fr"), "t")
        self.assertEqual(e.exception.status_code, 400)
        self.assertIn("déjà utilisée", e.exception.detail)
