"""The free month is given once: deleting the account and signing up again keeps the first month's start."""
import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from paybybot3 import web


def session(username, plates):
    return SimpleNamespace(username=username, demo=False,
                           call=lambda name: [{"licensePlate": p} for p in plates] if name == "get_vehicles" else None)


class OneFreeMonth(unittest.TestCase):
    def setUp(self):
        self.trials = {}

        def fake_store(fn, **p):
            if fn == "trial_mark":
                for k in p["p_keys"]:
                    self.trials[k] = min(self.trials.get(k, p["p_start"]), p["p_start"])
            elif fn == "trial_first":
                found = [self.trials[k] for k in p["p_keys"] if k in self.trials]
                return min(found) if found else None
        self.patches = [patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "HOSTED", True),
                        patch.object(web, "store", side_effect=fake_store)]
        for x in self.patches:
            x.start()

    def tearDown(self):
        for x in self.patches:
            x.stop()

    def test_same_account_email_or_vehicle_keeps_the_first_start(self):
        start = datetime.now(timezone.utc) - timedelta(days=29)
        web.mark_trial(session("+33612345678", ["AB123CD"]), start, "david.g+pbb@gmail.com")
        for again in [session("+33612345678", []),  # same PayByPhone account
                      session("+33699999999", ["AB-123-CD"]),  # another account, same car
                      session("+33699999999", [])]:  # another account, same e-mail written differently
            email = "davidg@gmail.com" if not again.call("get_vehicles") and again.username != "+33612345678" else None
            self.assertEqual(web.earlier_trial(again, email), start)

    def test_someone_new_gets_a_new_month(self):
        web.mark_trial(session("+33612345678", ["AB123CD"]), datetime.now(timezone.utc), "a@gmail.com")
        self.assertIsNone(web.earlier_trial(session("+33700000000", ["EF456GH"]), "b@gmail.com"))

    def test_nothing_readable_is_kept(self):
        web.mark_trial(session("+33612345678", ["AB123CD"]), datetime.now(timezone.utc), "a@gmail.com")
        stored = " ".join(self.trials)
        for clear in ["33612345678", "AB123CD", "a@gmail.com"]:
            self.assertNotIn(clear, stored)


if __name__ == "__main__":
    unittest.main()
