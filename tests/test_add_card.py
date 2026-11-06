import unittest
from unittest.mock import patch

from fastapi import HTTPException

from paybybot3 import web

CARD = {"number": "4970 1000 0000 0063", "month": "12", "year": "34", "cvv": "123", "name": "David Guenoun"}


def demo_session():
    s = web.UserSession.for_bot(web.DemoBot())
    s.demo = True
    return s


class AddCard(unittest.TestCase):
    def setUp(self):
        self.s = demo_session()
        p = patch.object(web, "current", return_value=self.s)
        p.start()
        self.addCleanup(p.stop)

    def test_the_card_reaches_the_paybyphone_account(self):
        self.assertEqual(web.add_card(dict(CARD)), {"ok": True})
        cards = web.normalize_accounts(self.s.call("get_payment_accounts"))
        self.assertTrue(any(c["label"].endswith("0063 — exp. 12/34") for c in cards))

    def test_a_mistyped_number_is_refused_before_paybyphone(self):
        with patch.object(self.s, "call", side_effect=AssertionError("sent")):
            for bad in ({"number": "4970 1000 0000 0064"}, {"month": "13"}, {"year": "20"}, {"cvv": "1"}, {"name": ""}):
                with self.assertRaises(HTTPException):
                    web.add_card({**CARD, **bad})

    def test_a_refusal_never_logs_the_card(self):
        with patch.object(self.s, "call", side_effect=RuntimeError('GraphQL error: [{"cardNumber": "4970100000000063"}]')), \
                self.assertLogs("paybybot3.web", "WARNING") as logs:
            with self.assertRaises(HTTPException):
                web.add_card(dict(CARD))
        self.assertNotIn("4970", " ".join(logs.output))
        self.assertNotRegex(" ".join(logs.output), r"\d{3}")
