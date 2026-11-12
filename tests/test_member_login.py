"""One PayByPhone account, one PayByBot account: PayByPhone's own account id (memberid in its token) maps every
way of typing the login (0777…, +33 7 77…) to the first one seen, so the account, renewals and subscription are found
again whatever the format."""
import base64
import json
import os
import unittest
from unittest.mock import patch

from paybybot3 import web


def bot(member):
    claims = base64.urlsafe_b64encode(json.dumps({"sub": member, "memberid": member}).encode()).decode().rstrip("=")
    return type("B", (), {"authorization": "Bearer h.%s.s" % claims})()


class CanonicalLogin(unittest.TestCase):
    def run_logins(self, *logins, member="m-1", accounts=("+33777920788",)):
        kept = {}

        def store(fn, p_key=None, p_login=None, p_owner=None):
            if fn == "member_login_get":
                return kept.get(p_key)
            if fn == "member_login_set":
                kept.setdefault(p_key, p_login)
            if fn in ("account_get", "renewal_list"):
                return "x" if p_owner in {web.owner_id(a) for a in accounts} else None

        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "HOSTED", True), \
                patch.object(web, "store", side_effect=store):
            return [web.canonical_login(bot(member), x) for x in logins]

    def test_first_login_is_kept(self):
        self.assertEqual(self.run_logins("+33777920788"), ["+33777920788"])

    def test_another_format_of_the_same_account_gives_the_first_login(self):
        self.assertEqual(self.run_logins("+33777920788", "+330777920788"), ["+33777920788", "+33777920788"])

    def test_an_existing_account_is_found_whatever_format_comes_first(self):
        # Signed up as +33777920788 before the link existed; first sign-in now typed 0777920788 / +330777920788.
        self.assertEqual(self.run_logins("0777920788", "+330777920788"), ["+33777920788", "+33777920788"])

    def test_no_account_yet_nothing_is_linked_so_nobody_is_locked_out(self):
        self.assertEqual(self.run_logins("+33611111111", "+330611111111", accounts=()),
                         ["+33611111111", "+330611111111"])

    def test_another_account_keeps_its_own_login(self):
        a = self.run_logins("+33611111111", member="m-1")
        b = self.run_logins("+33622222222", member="m-2")
        self.assertEqual((a, b), (["+33611111111"], ["+33622222222"]))

    def test_no_member_id_or_failed_lookup_keeps_the_typed_login(self):
        with patch.object(web, "HOSTED", True):
            self.assertEqual(web.canonical_login(type("B", (), {"authorization": "Bearer opaque"})(), "+33777"), "+33777")
            with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "store", side_effect=RuntimeError):
                self.assertEqual(web.canonical_login(bot("m-1"), "+33777"), "+33777")

    def test_local_mode_untouched(self):
        with patch.object(web, "HOSTED", False):
            self.assertEqual(web.canonical_login(bot("m-1"), "+33777"), "+33777")


if __name__ == "__main__":
    unittest.main()
