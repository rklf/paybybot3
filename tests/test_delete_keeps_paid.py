"""A subscriber who deletes the account keeps what is paid: the subscription stops at the end of the paid period
(nothing more charged), and coming back before then resumes it, never asking to pay twice."""
import unittest
from unittest.mock import patch

from paybybot3 import web


class Ending(unittest.TestCase):
    def end(self, status):
        calls = []

        def stripe(method, path, **data):
            calls.append((method, path, data))
            return {"id": "sub_1", "status": status, "current_period_end": 1796000000}

        with patch.dict("os.environ", {"STRIPE_SECRET_KEY": "sk"}), patch.object(web, "stripe", side_effect=stripe):
            web.end_subscription_with_account("sub_1")
        return calls[1:]

    def test_a_paid_subscription_stops_at_the_end_of_the_paid_period(self):
        [(method, path, data)] = self.end("active")
        self.assertEqual((method, path), ("POST", "subscriptions/sub_1"))
        self.assertEqual(data["cancel_at_period_end"], "true")
        self.assertEqual(data["metadata[account_deleted]"], "1")

    def test_an_unpaid_one_stops_at_once(self):
        [(method, path, _)] = self.end("past_due")
        self.assertEqual((method, path), ("DELETE", "subscriptions/sub_1"))


class ComingBack(unittest.TestCase):
    def come_back(self, sub):
        calls, saved = [], []

        def stripe(method, path, **data):
            calls.append((method, path, data))
            return {"data": [sub]} if path.startswith("subscriptions/search") else sub

        with patch.dict("os.environ", {"STRIPE_SECRET_KEY": "sk"}), patch.object(web, "stripe", side_effect=stripe), \
                patch.object(web, "save_account_by_owner", side_effect=lambda o, p: saved.append(p)):
            web.resume_after_signup("owner-1", {})
        return [c for c in calls if c[0] == "POST"], saved

    def sub(self, **extra):
        return {"id": "sub_1", "customer": "cus_1", "status": "active", "metadata": {"owner": "owner-1", "plan": "monthly"},
                **extra}

    def test_the_subscription_ended_with_the_account_is_resumed(self):
        posts, saved = self.come_back(self.sub(cancel_at_period_end=True,
                                               metadata={"owner": "owner-1", "plan": "monthly", "account_deleted": "1"}))
        self.assertEqual(posts[0][2]["cancel_at_period_end"], "false")
        self.assertEqual(saved[0]["stripe_subscription"], "sub_1")

    def test_one_the_user_cancelled_himself_is_recorded_but_not_resumed(self):
        posts, saved = self.come_back(self.sub(cancel_at_period_end=True))
        self.assertEqual(posts, [])
        self.assertEqual(saved[0]["stripe_subscription"], "sub_1")

    def test_nothing_found_nothing_done(self):
        calls = []
        with patch.dict("os.environ", {"STRIPE_SECRET_KEY": "sk"}), \
                patch.object(web, "stripe", side_effect=lambda m, p, **d: calls.append(m) or {"data": []}), \
                patch.object(web, "save_account_by_owner") as save:
            web.resume_after_signup("owner-1", {})
        save.assert_not_called()


if __name__ == "__main__":
    unittest.main()
