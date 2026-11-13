"""The free month needs no card: a renewal is activated at once (the month starts then), the subscription is asked by
e-mail near its end (days 21, 27 and 30), and only after it does a renewal pause."""
from datetime import datetime, timedelta, timezone
import json
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from paybybot3 import web

NOW = datetime(2026, 11, 30, 9, 0, tzinfo=timezone.utc)


class Activation(unittest.TestCase):
    def test_no_subscription_needed_during_the_free_month(self):
        with patch.object(web, "billing_state", return_value="trial"), patch.object(web, "load_account", return_value={}), \
                patch.object(web, "owner_id", return_value="o"):
            web.check_offer(type("S", (), {"username": "u"})())  # no exception: activated at once

    def test_after_the_free_month_the_subscription_is_asked(self):
        with patch.object(web, "billing_state", return_value="trial_over"), patch.object(web, "load_account", return_value={}), \
                patch.object(web, "owner_id", return_value="o"), self.assertRaises(HTTPException) as e:
            web.check_offer(type("S", (), {"username": "u"})())
        self.assertEqual(e.exception.status_code, 402)

    def test_the_first_activation_starts_the_free_month(self):
        saved = []
        with patch.object(web, "load_account", return_value={"email": "a@b.fr"}), \
                patch.object(web, "save_account", side_effect=lambda s, p: saved.append(p) or p), \
                patch.object(web, "mark_trial") as marked:
            web.begin_free_month(object())
        self.assertIn("trial_start", saved[0])
        marked.assert_called_once()

    def test_an_earlier_start_is_kept(self):
        with patch.object(web, "load_account", return_value={"trial_start": "2026-11-01T00:00:00+00:00"}), \
                patch.object(web, "save_account") as save:
            web.begin_free_month(object())
        save.assert_not_called()


class Reminders(unittest.TestCase):
    def run_on(self, started_days_ago, account=None, now=NOW):
        account = {"email": "a@b.fr", "trial_start": (now - timedelta(days=started_days_ago)).isoformat(), **(account or {})}
        mails, saved = [], []
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}):
            rows = [{"owner": "o1", "data": web._fernet("account").encrypt(json.dumps(account).encode()).decode()}]
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "store", return_value=rows), \
                patch.object(web, "send_email", side_effect=lambda to, subject, *a, **k: mails.append(subject) or True), \
                patch.object(web, "save_account_by_owner", side_effect=lambda o, p: saved.append(p)), \
                patch.object(web, "billing_state", return_value="trial"), \
                patch.object(web, "unlock_link", return_value="https://paybybot.fr/x"):
            web.run_trial_reminders(now)
        return mails, saved

    def test_nothing_before_day_21(self):
        self.assertEqual(self.run_on(15)[0], [])

    def test_day_21_then_27_then_30(self):
        for days, word in ((21, "9 jours"), (27, "3 jours"), (29, "Dernier jour")):
            mails, saved = self.run_on(days)
            self.assertEqual(len(mails), 1, days)
            self.assertIn(word, mails[0])
            self.assertTrue(saved[0]["trial_mailed"])

    def test_each_one_once(self):
        mails, _ = self.run_on(22, {"trial_mailed": ["j21"]})
        self.assertEqual(mails, [])

    def test_only_the_latest_when_several_are_due(self):
        mails, saved = self.run_on(28)
        self.assertEqual(len(mails), 1)
        self.assertIn("3 jours", mails[0])
        self.assertEqual(saved[0]["trial_mailed"], ["j21", "j27"])

    def test_not_to_a_subscriber(self):
        self.assertEqual(self.run_on(27, {"stripe_subscription": "sub_1"})[0], [])

    def test_not_after_the_free_month(self):
        self.assertEqual(self.run_on(35)[0], [])


if __name__ == "__main__":
    unittest.main()
