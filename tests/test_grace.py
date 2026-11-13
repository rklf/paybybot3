import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from paybybot3 import web


class GraceWeek(unittest.TestCase):
    """After a refused charge: 7 days of renewals, e-mails on days 0, 3, 6 and 7, then renewals stop."""

    def setUp(self):
        self.days, self.status, self.meta = 0, "past_due", {}
        self.accounts = {"own1": {"email": "a@b.fr", "stripe_subscription": "sub_1", "plan": "monthly"}}
        self.sent = []
        self.patches = [
            patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk_test_x"}),
            patch.object(web, "stripe", side_effect=self.fake_stripe),
            patch.object(web, "admin_owners", return_value=set()),
            patch.object(web, "account_by_owner", side_effect=lambda o: dict(self.accounts.get(o, {}))),
            patch.object(web, "save_account_by_owner", side_effect=self.save),
            patch.object(web, "send_email", side_effect=lambda to, subject, *a, **k: self.sent.append(subject)),
            patch.object(web, "unlock_link", return_value="https://paybybot.fr/api/billing/unlock?t=x"),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def save(self, owner, patch_):
        self.accounts[owner] = {**self.accounts.get(owner, {}), **patch_}
        return self.accounts[owner]

    def sub(self):
        finalized = int((datetime.now(timezone.utc) - timedelta(days=self.days, minutes=1)).timestamp())
        return {"id": "sub_1", "status": self.status, "metadata": self.meta,
                "latest_invoice": {"id": "in_1", "status_transitions": {"finalized_at": finalized}}}

    def fake_stripe(self, method, path, **data):
        if path.startswith("subscriptions/sub_1"):
            if method == "POST":
                self.meta["owner"] = data["metadata[owner]"]
                return {}
            return self.sub()
        if path.startswith("subscriptions?"):
            return {"data": [self.sub()] if "status=" + self.status in path else []}
        if path.startswith("checkout/sessions?"):
            return {"data": [{"client_reference_id": "own1"}]}
        raise AssertionError(path)

    def test_renewals_go_on_for_a_week(self):
        account = self.accounts["own1"]
        for day, state in ((0, "grace"), (6, "grace"), (7, "unpaid")):
            self.days = day
            self.assertEqual(web.billing_state(account, "own1"), state)
        self.status = "active"
        self.assertEqual(web.billing_status(account, "own1"), ("ok", None))

    def test_four_e_mails_each_sent_once(self):
        for day in (0, 0, 1, 3, 3, 5, 6, 7, 7, 9):
            self.days = day
            web.run_dunning()
        self.assertEqual(len(self.sent), 4)
        self.assertIn("refusé", self.sent[0])
        self.assertIn("Rappel", self.sent[1])
        self.assertIn("Dernier jour", self.sent[2])
        self.assertIn("arrêté", self.sent[3])
        self.assertEqual(self.meta, {"owner": "own1"})  # found once from Checkout, then on the subscription

    def test_activation_needs_a_subscription(self):
        self.status = "canceled"
        self.accounts["own1"]["trial_start"] = datetime.now(timezone.utc).isoformat()
        self.assertEqual(web.billing_state(self.accounts["own1"], "own1"), "trial")


if __name__ == "__main__":
    unittest.main()
