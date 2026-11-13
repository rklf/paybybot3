import unittest
from unittest.mock import patch

from fastapi import HTTPException

from paybybot3 import web


class AccessRequest(unittest.TestCase):
    def ask(self, email, counts=None):
        sent = []
        with patch.object(web, "HOSTED", True), patch.object(web, "SHARED_INVITE", "nw0T35Cf"), \
                patch.object(web, "check_human"), patch.object(web, "record_activity"), \
                patch.object(web, "store", side_effect=lambda fn, p_keys: {k: (counts or {}).get(k.split(":")[0], 1)
                                                                          for k in p_keys}), \
                patch.object(web, "send_email", side_effect=lambda to, subject, title, lines, button=None, **k:
                             sent.append((to, button))):
            try:
                web.request_access(web.AccessAsk(email=email), None)
                status = 200
            except HTTPException as e:
                status = e.status_code
        return status, sent

    def test_the_link_is_mailed(self):
        r, sent = self.ask("julie.martin@gmail.com")
        self.assertEqual(r, 200)
        self.assertEqual(sent, [("julie.martin@gmail.com", ("Ouvrir PayByBot", web.APP_URL.rstrip("/") + "/r/nw0T35Cf/?s=acces"))])

    def test_a_wrong_address_is_refused(self):
        r, sent = self.ask("julie@gmial.com")
        self.assertEqual(r, 400)
        self.assertEqual(sent, [])

    def test_the_same_address_at_most_3_times_a_day(self):
        r, sent = self.ask("julie.martin@gmail.com", counts={"access-email": 4})
        self.assertEqual(r, 200)  # same answer, nothing sent: no way to tell
        self.assertEqual(sent, [])

    def test_a_daily_cap_keeps_the_quota(self):
        r, sent = self.ask("julie.martin@gmail.com", counts={"access-day": 51})
        self.assertEqual(r, 429)
        self.assertEqual(sent, [])



class Origin(unittest.TestCase):
    def test_the_e_mailed_link_means_no_referral(self):
        self.assertEqual(web.signup_origin("acces"), "sans_parrainage")
        self.assertEqual(web.signup_origin("wa"), "parrainage")
        self.assertEqual(web.signup_origin(""), "parrainage")


if __name__ == "__main__":
    unittest.main()
