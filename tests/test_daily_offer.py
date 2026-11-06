"""Online, a non-resident ticket on precise days needs an offer, exactly as the weekly renewal."""
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from paybybot3 import web


class DailyNeedsAnOffer(unittest.TestCase):
    def add(self, state, plate="AB123CD", **extra):
        s = SimpleNamespace(username="u@x.fr", demo=False, bot=SimpleNamespace(refresh_token="r"), autopilots={},
                            call=lambda name, *a, **k: [{"licensePlate": "AB-123-CD"}] if name == "get_vehicles" else {})
        body = web.Autopilot(plate=plate, location="75015", rate="201", duration=6, unit="Hours",
                             paymentAccountId="card-1", label="Jours précis", email="u@x.fr", **extra)
        saved = []
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "HOSTED", True), patch.object(web, "current", return_value=s), \
                patch.object(web, "renewed_plates", return_value=set()), \
                patch.object(web, "normalize_accounts", return_value=[{"id": "card-1", "kind": "card"}]), \
                patch.object(web, "load_account", return_value={}), \
                patch.object(web, "billing_state", return_value=state), \
                patch.object(web, "store", side_effect=lambda fn, **p: saved.append(fn) or None):
            try:
                web.add_autopilot(body, "t")
            except HTTPException as e:
                return e.status_code, e.detail, saved
        return 200, "", saved

    def test_free_month_without_offer_is_refused_for_precise_days(self):
        for extra in ({"days": [5], "start": "09:00"}, {}):  # precise days, and the weekly renewal alike
            status, detail, saved = self.add("trial", **extra)
            self.assertEqual(status, 402)
            self.assertIn("Abonnez-vous", detail)
            self.assertEqual(saved, [])  # nothing stored

    def test_blocked_account_is_refused(self):
        status, detail, _ = self.add("unpaid", days=[5], start="09:00")
        self.assertEqual(status, 402)
        self.assertIn("bloqué", detail)

    def test_with_an_offer_it_is_saved(self):
        status, _, saved = self.add("ok", days=[5], start="09:00")
        self.assertNotEqual(status, 402)  # past the offer check: the rule is stored (the rest is not mocked here)
        self.assertIn("renewal_save", saved)


if __name__ == "__main__":
    unittest.main()

    def test_a_plate_not_on_the_account_is_refused(self):
        status, detail, saved = self.add("ok", plate="ZZ999ZZ", days=[5], start="09:00")
        self.assertEqual(status, 400)
        self.assertIn("pas sur votre compte", detail)
        self.assertEqual(saved, [])
