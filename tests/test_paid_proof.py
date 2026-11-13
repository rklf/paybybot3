"""Proof that PayByBot works: every ticket it pays is kept with its renewal (when, which car and zone, until when, the
price), and « Historique » lists those only, never a ticket the user bought himself on PayByPhone."""
from datetime import datetime, timedelta, timezone
import os
import unittest
from unittest.mock import MagicMock, patch

from paybybot3 import web

NOW = datetime(2026, 11, 11, 19, 0, tzinfo=timezone.utc)


class Recording(unittest.TestCase):
    def test_a_paid_ticket_is_kept_newest_last_and_capped(self):
        row = {"plate": "AB123CD", "location": "75001", "paid": [{"at": "x%d" % i} for i in range(60)]}
        patch_ = {}
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}):
            web.keep_paid(row, patch_, NOW, NOW + timedelta(days=7), {"amount": 9.0, "currency": "EUR"})
            kept = web.decrypt_details(patch_["data"])["paid"]
        self.assertEqual(len(kept), web.PAID_KEPT)
        self.assertEqual(kept[-1]["zones"], ["75001"])
        self.assertEqual(kept[-1]["cost"], 9.0)
        self.assertEqual(kept[-1]["until"], web.utc_iso(NOW + timedelta(days=7)))

    def test_several_zones(self):
        patch_ = {}
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}):
            web.keep_paid({"plate": "AB123CD", "location": "75001", "locations": ["75001", "75002"]}, patch_, NOW, None, None)
            self.assertEqual(web.decrypt_details(patch_["data"])["paid"][-1]["zones"], ["75001", "75002"])


class History(unittest.TestCase):
    def test_only_what_paybybot_paid_newest_first(self):
        rows = [{"id": "r1", "enabled": True, "plate": "AB123CD", "location": "75001", "paid": [
                    {"at": "2026-11-01T19:00:00+00:00", "until": "2026-11-08T19:00:00+00:00", "zones": ["75001"], "cost": 9.0},
                    {"at": "2026-11-07T19:00:00+00:00", "until": "2026-11-15T19:00:00+00:00", "zones": ["75001"], "cost": 9.0}]},
                {"id": "r2", "enabled": False, "plate": "GH456JK", "location": "75017", "days": [1], "paid": []}]
        s = MagicMock(demo=False, username="u")
        with patch.object(web, "HOSTED", True), patch.object(web, "current", return_value=s), \
                patch.object(web, "store", return_value=rows), patch.object(web, "with_details", side_effect=lambda r: r), \
                patch.object(web, "owner_id", return_value="o"):
            listed = web.history("t")
        self.assertEqual([x["start"] for x in listed], ["2026-11-07T19:00:00+00:00", "2026-11-01T19:00:00+00:00"])
        self.assertEqual((listed[0]["plate"], listed[0]["location"], listed[0]["resident"]), ("AB123CD", "75001", True))
        self.assertEqual(listed[0]["cost"], {"amount": 9.0, "currency": "EUR"})
        s.call.assert_not_called()  # nothing asked to PayByPhone: the proof is PayByBot's own

    def test_nothing_paid_yet_nothing_listed(self):
        s = MagicMock(demo=False, username="u")
        with patch.object(web, "HOSTED", True), patch.object(web, "current", return_value=s), \
                patch.object(web, "store", return_value=[{"id": "r1", "plate": "AB123CD", "location": "75001"}]), \
                patch.object(web, "with_details", side_effect=lambda r: r), patch.object(web, "owner_id", return_value="o"):
            self.assertEqual(web.history("t"), [])


if __name__ == "__main__":
    unittest.main()
