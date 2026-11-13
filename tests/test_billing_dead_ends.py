"""Billing dead ends: a subscriber is never sent to pay a second time, Checkout works whatever the month, a Stripe
outage is a clear message (never a crash), and a missing Stripe key never blocks a paying customer."""
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import MagicMock, patch

import requests
from fastapi import HTTPException

from paybybot3 import web


class Unlock(unittest.TestCase):
    def test_an_active_subscription_goes_to_the_dashboard_not_a_new_checkout(self):
        with patch.object(web, "stripe", return_value={"status": "active"}), \
                patch.object(web, "checkout_url") as checkout:
            url = web.unlock_url("o", {"stripe_subscription": "sub_1"}, portal=False)
        checkout.assert_not_called()
        self.assertEqual(url, web.APP_URL.rstrip("/") + "/")

    def test_a_subscription_paid_but_not_recorded_is_found_first(self):
        with patch.object(web, "recover_subscription", return_value=True), \
                patch.dict("os.environ", {"STRIPE_SECRET_KEY": "sk"}), patch.object(web, "checkout_url") as checkout:
            url = web.unlock_url("o", {}, portal=False)
        checkout.assert_not_called()
        self.assertEqual(url, web.APP_URL.rstrip("/") + "/")

    def test_the_e_mail_checkout_is_remembered(self):
        saved = []
        with patch.object(web, "recover_subscription", return_value=False), \
                patch.dict("os.environ", {"STRIPE_SECRET_KEY": "sk"}), \
                patch.object(web, "save_account_by_owner", side_effect=lambda o, p: saved.append(p)), \
                patch.object(web, "checkout_url", return_value="https://checkout"):
            self.assertEqual(web.unlock_url("o", {}, portal=False), "https://checkout")
        self.assertIn("checkout_at", saved[0])


class Anchor(unittest.TestCase):
    def data_on(self, now, start=None):
        sent = {}
        real = datetime

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return now

        with patch.object(web, "datetime", Clock), \
                patch.object(web, "stripe", side_effect=lambda m, p, **d: sent.update(d) or {"url": "u"}):
            web.checkout_url("o", {"trial_start": start.isoformat() if start else None}, "monthly", "s")
        return sent, real

    def test_february_never_asks_stripe_for_an_anchor_beyond_one_month(self):
        now = datetime(2027, 2, 1, 10, tzinfo=timezone.utc)
        sent, _ = self.data_on(now)
        anchor = sent.get("subscription_data[billing_cycle_anchor]")
        if anchor:
            self.assertLessEqual(anchor, int(datetime(2027, 3, 1, 10, tzinfo=timezone.utc).timestamp()))
        else:
            self.assertEqual(sent["subscription_data[trial_end]"], int((now + timedelta(days=30)).timestamp()))

    def test_a_usual_month_keeps_the_anchor_on_the_free_month_end(self):
        now = datetime(2026, 11, 12, 10, tzinfo=timezone.utc)
        sent, _ = self.data_on(now)
        self.assertEqual(sent["subscription_data[billing_cycle_anchor]"], int((now + timedelta(days=30)).timestamp()))


class Outage(unittest.TestCase):
    def test_stripe_unreachable_is_a_502_not_a_crash(self):
        with patch.dict("os.environ", {"STRIPE_SECRET_KEY": "sk"}), \
                patch.object(web.requests, "request", side_effect=requests.ConnectionError("down")), \
                self.assertRaises(HTTPException) as e:
            web.stripe("GET", "subscriptions/x")
        self.assertEqual(e.exception.status_code, 502)

    def test_no_stripe_key_never_blocks_a_stored_subscription(self):
        old = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        with patch.dict("os.environ", {"STRIPE_SECRET_KEY": ""}):
            self.assertEqual(web.billing_status({"stripe_subscription": "sub_1", "trial_start": old}, "o")[0], "ok")


class BlockedIsNotARefusedCard(unittest.TestCase):
    def test_a_billing_block_does_not_switch_the_card(self):
        self.assertFalse(web.card_refused_before(web.BLOCKED))
        self.assertTrue(web.card_refused_before("Paiement refusé par la banque"))
        self.assertFalse(web.card_refused_before(None))


if __name__ == "__main__":
    unittest.main()
