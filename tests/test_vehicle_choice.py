"""One price for every vehicle of the account: 9,50 € a month (91,20 € a year), whatever their number."""
import os
import unittest
from unittest.mock import patch

from paybybot3 import web


def account_with(plates):
    s = web.UserSession("demo", "", demo=True)
    s.demo = False  # the demo bot, but checkout as for a real account (not hosted: the account stays in memory)
    s.bot.get_vehicles = lambda: [{"licensePlate": p, "type": "Car", "archived": False} for p in plates]
    return s


class OnePrice(unittest.TestCase):
    def checkout(self, s, plan="yearly"):
        seen = {}

        def fake_url(owner, account, plan, success):
            seen["amount"] = web.plan_total(web.account_monthlies(account), plan)
            return "https://checkout.stripe.test"
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk_test", "PAYBYBOT_SECRET": "t"}), \
                patch.object(web, "current", return_value=s), patch.object(web, "checkout_url", side_effect=fake_url), \
                patch.object(web, "vehicle_zones", return_value=[]), patch.object(web, "reprice", return_value=False):
            web.billing_checkout(web.Checkout(plan=plan), None, "t")
        return seen["amount"]

    def test_three_vehicles_cost_the_same_as_one(self):
        self.assertEqual(self.checkout(account_with(["AB123CD"]), "monthly"), 950)
        self.assertEqual(self.checkout(account_with(["AB123CD", "EF456GH", "IJ789KL"]), "monthly"), 950)
        self.assertEqual(self.checkout(account_with(["AB123CD", "EF456GH", "IJ789KL"]), "yearly"), 950)  # yearly is gone: monthly

    def test_every_vehicle_is_covered(self):
        s = account_with(["AB123CD", "EF456GH"])
        with patch.object(web, "vehicle_zones", return_value=[]), patch.object(web, "reprice", return_value=False):
            found = web.account_pricing(s)
        self.assertEqual(found["billed"], ["AB123CD", "EF456GH"])
        self.assertEqual(found["monthly"], 950)

    def test_a_subscription_billed_per_vehicle_comes_back_to_one_price(self):
        account = {"stripe_subscription": "sub_1", "plan": "monthly", "monthlies": [950],
                   "billed_monthlies": [950, 950, 950]}
        sub = {"status": "active", "items": {"data": [{"id": "si_1", "price": {
            "unit_amount": 2850, "recurring": {"interval": "month"}}}]}}
        sent = []

        def fake(method, path, **kw):
            sent.append((method, path, kw))
            return sub if method == "GET" else {}
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk_test"}), patch.object(web, "stripe", side_effect=fake), \
                patch.object(web, "active_product", return_value="prod_1"), \
                patch.object(web, "save_account_by_owner") as saved:
            self.assertTrue(web.reprice(account, "owner"))
        post = [kw for m, _, kw in sent if m == "POST"][0]
        self.assertEqual(post["items[0][price_data][unit_amount]"], 950)
        self.assertEqual(post["proration_behavior"], "none")
        saved.assert_called_with("owner", {"billed_monthlies": [950]})


if __name__ == "__main__":
    unittest.main()
