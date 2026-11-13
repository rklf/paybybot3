import os
import unittest
from unittest.mock import patch

from paybybot3 import web


class OwnerAlert(unittest.TestCase):
    def test_a_failed_renewal_alerts_the_owner_even_without_customer_email(self):
        sent = []
        with patch.dict(os.environ, {"PAYBYBOT_ADMIN_EMAIL": "owner@x.fr"}), \
                patch.object(web, "send_email", side_effect=lambda to, *a, **k: sent.append(to)):
            web.notify({"plate": "AB123CD", "location": "75016"}, "problem", message="Carte refusée")
        self.assertEqual(sent, ["owner@x.fr"])  # the customer gave no e-mail: only the owner

    def test_no_alert_for_a_payment(self):
        with patch.object(web, "alert_owner") as alert, patch.object(web, "send_email"):
            web.notify({"plate": "AB123CD", "location": "75016", "email": "c@x.fr", "duration": 1, "unit": "Days"},
                       "paid", cost=None, expire=None)
        alert.assert_not_called()
