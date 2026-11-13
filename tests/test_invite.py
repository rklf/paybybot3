import unittest
from unittest.mock import patch

from fastapi import HTTPException

from paybybot3 import web


class Invite(unittest.TestCase):
    def test_a_users_code_is_valid_and_a_made_up_one_is_not(self):
        code = web.invite_code(web.owner_id("0611223344"))
        self.assertEqual(len(code), 14)
        self.assertTrue(web.valid_invite(code))
        self.assertTrue(web.valid_invite(code.upper()))
        self.assertFalse(web.valid_invite(code[:8] + "000000"))
        self.assertFalse(web.valid_invite(""))
        self.assertFalse(web.valid_invite("not a code"))

    def test_invite_only_sign_up_needs_a_valid_code(self):
        body = web.Login(username="0611223344", password="x", signup=True, email="a@b.fr", accepted=True)
        with patch.object(web, "INVITE_ONLY", True), patch.object(web, "HOSTED", False), \
                self.assertRaises(HTTPException) as refused:
            web.login(body, None, None)
        self.assertEqual(refused.exception.status_code, 403)

    def test_one_shared_link_when_set(self):
        with patch.object(web, "SHARED_INVITE", "paris2026"):
            self.assertTrue(web.valid_invite("paris2026"))
            self.assertFalse(web.valid_invite("paris2027"))
            self.assertFalse(web.valid_invite(web.invite_code(web.owner_id("0611223344"))))  # no personal codes then

    def test_link_detail_is_where_from_first_visit_time_and_step_without_ip(self):
        class Req:
            headers = {"x-vercel-ip-city": "Paris%2015e", "x-vercel-ip-country": "FR", "x-real-ip": "203.0.113.7"}
        body = web.LinkOpen(source="WhatsApp", device="iPhone", visit=1)
        self.assertEqual(web.link_detail(body, Req()), "WhatsApp · iPhone · Paris 15e, FR · 1re visite")
        again = web.LinkOpen(source="WhatsApp", device="iPhone", visit=3)
        self.assertEqual(web.link_detail(again, Req(), "code", 95),
                         "WhatsApp · iPhone · Paris 15e, FR · déjà venu 2 fois · 1 min 35 s · → arrêté à : code e-mail envoyé")
        self.assertIn("rebond (3 s)", web.link_detail(body, Req(), "", 3))
        self.assertIn("→ inscrit", web.link_detail(body, Req(), "inscrit", 40))
        self.assertNotIn("203.0.113.7", web.link_detail(body, Req(), "inscrit", 40))

    def test_only_the_visitor_holding_the_signature_updates_the_row(self):
        class Req:
            headers = {}
        with self.assertRaises(HTTPException):
            web.link_progress(web.LinkProgress(id=5, sig="forged", step="inscrit"), Req())
        web.link_progress(web.LinkProgress(id=5, sig=web.link_sig(5), step="inscrit", seconds=12), Req())  # accepted
