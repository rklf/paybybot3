"""« Historique »: the tickets of the cars and zones PayByBot automates (running and past, from PayByPhone), newest
first; the account's other tickets (paid by hand elsewhere) are not listed."""
from datetime import datetime, timedelta
import unittest
from unittest.mock import MagicMock, patch

from paybybot3 import web


def ticket(i, plate="AB123CD", zone="75001", days_ago=7):
    start = datetime(2026, 11, 11) - timedelta(days=days_ago)
    return {"parkingSessionId": "t%d" % i, "locationId": zone, "vehicle": {"licensePlate": plate},
            "startTime": start, "expireTime": start + timedelta(days=7), "ratePolicy": {"ratePolicyId": "1", "type": "Resident"},
            "totalCost": {"amount": 9.0, "currency": "EUR"}}


class History(unittest.TestCase):
    def run_with(self, running, past, automated):
        s = MagicMock(demo=False)
        s.call.side_effect = lambda name, **k: {"get_parking_sessions": running, "get_past_sessions": past}[name]
        with patch.object(web, "current", return_value=s), patch.object(web, "automated_places", return_value=automated):
            return web.history("t")

    def test_only_paybybots_cars_and_zones_newest_first(self):
        rows = self.run_with([ticket(1, days_ago=1)], [ticket(2, days_ago=8), ticket(3, plate="ZZ999ZZ"), ticket(4, zone="75017")],
                             {("AB123CD", "75001")})
        self.assertEqual([r["id"] for r in rows], ["t1", "t2"])
        self.assertEqual(rows[0]["cost"], {"amount": 9.0, "currency": "EUR"})

    def test_nothing_automated_nothing_listed(self):
        self.assertEqual(self.run_with([], [ticket(1)], set()), [])

    def test_paybyphone_silent_still_answers(self):
        s = MagicMock(demo=False)
        s.call.side_effect = RuntimeError("down")
        with patch.object(web, "current", return_value=s), patch.object(web, "automated_places", return_value={("AB123CD", "75001")}):
            self.assertEqual(web.history("t"), [])


if __name__ == "__main__":
    unittest.main()
