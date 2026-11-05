"""The offer screen's vehicle choice: the subscription is priced for the vehicles ticked (and any renewed one)."""
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from paybybot3 import web


def account_with(plates):
    s = web.UserSession("demo", "", demo=True)
    s.demo = False  # the demo bot, but checkout as for a real account (not hosted: the account stays in memory)
    s.bot.get_vehicles = lambda: [{"licensePlate": p, "type": "Car", "archived": False} for p in plates]
    return s


class VehicleChoice(unittest.TestCase):
    def checkout(self, s, plates):
        seen = {}

        def fake_url(owner, account, plan, success):
            seen["monthlies"] = web.account_monthlies(account)
            return "https://checkout.stripe.test"
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk_test", "PAYBYBOT_SECRET": "t"}), \
                patch.object(web, "current", return_value=s), patch.object(web, "checkout_url", side_effect=fake_url), \
                patch.object(web, "vehicle_zones", return_value=[]), patch.object(web, "reprice", return_value=False):
            web.billing_checkout(web.Checkout(plan="yearly", plates=plates), None, "t")
        return seen["monthlies"]

    def test_the_price_follows_the_number_of_vehicles_chosen(self):
        s = account_with(["AB123CD", "EF456GH", "IJ789KL"])
        self.assertEqual(self.checkout(s, ["AB-123-CD", "ef456gh"]), [web.MONTHLY_PRICE] * 2)
        self.assertEqual(self.checkout(s, ["AB123CD", "EF456GH", "IJ789KL"]), [web.MONTHLY_PRICE] * 3)

    def test_without_a_choice_one_vehicle_and_unknown_plates_refused(self):
        s = account_with(["AB123CD", "EF456GH"])
        self.assertEqual(self.checkout(s, []), [web.MONTHLY_PRICE])
        with self.assertRaises(HTTPException) as e:
            self.checkout(s, ["ZZ999ZZ"])
        self.assertEqual(e.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
