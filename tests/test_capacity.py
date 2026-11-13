import os
import unittest
from unittest.mock import MagicMock, patch

from paybybot3 import web


class OncePerKey(unittest.TestCase):
    def test_an_alert_goes_out_once(self):
        sent = []
        with patch.dict(os.environ, {"PAYBYBOT_ADMIN_EMAIL": "owner@x.fr"}), \
                patch.object(web, "send_email", side_effect=lambda to, *a, **k: sent.append(to)):
            with patch.object(web, "store", return_value={"alert:queue:2026-10-27": 1}):
                self.assertTrue(web.capacity_alert("queue:2026-10-27", "file en retard", ["x"]))
            with patch.object(web, "store", return_value={"alert:queue:2026-10-27": 2}):
                self.assertFalse(web.capacity_alert("queue:2026-10-27", "file en retard", ["x"]))
        self.assertEqual(sent, ["owner@x.fr"])


class EmailQuota(unittest.TestCase):
    def test_alert_at_80_percent_of_the_day(self):
        with patch.object(web, "HOSTED", True), patch.dict(os.environ, {"PAYBYBOT_EMAIL_DAY_LIMIT": "100"}), \
                patch.object(web, "store", side_effect=lambda fn, p_keys: {k: (80 if ":day:" in k else 90) for k in p_keys}), \
                patch.object(web, "capacity_alert") as alert:
            web.count_email()
        self.assertEqual([c.args[0].split(":")[0] for c in alert.call_args_list], ["email-day"])

    def test_nothing_below(self):
        with patch.object(web, "HOSTED", True), \
                patch.object(web, "store", side_effect=lambda fn, p_keys: {k: 10 for k in p_keys}), \
                patch.object(web, "capacity_alert") as alert:
            web.count_email()
        alert.assert_not_called()

    def test_resend_refusing_for_quota_alerts_at_once(self):
        refused = MagicMock(ok=False, status_code=429, text="daily_quota_exceeded")
        with patch.dict(os.environ, {"RESEND_API_KEY": "k"}), patch.object(web.requests, "post", return_value=refused), \
                patch.object(web, "capacity_alert") as alert:
            self.assertFalse(web.send_email("c@x.fr", "s", "t", ["l"]))
        self.assertEqual(alert.call_args.args[0].split(":")[0], "email-refused")


class Snapshot(unittest.TestCase):
    def check(self, snap):
        with patch.object(web, "store", return_value=snap), patch.object(web, "capacity_alert") as alert:
            web.check_capacity()
        return [c.args[0].split(":")[0] + ":" + c.args[0].split(":")[1] for c in alert.call_args_list]

    def test_a_queue_behind_alerts(self):
        self.assertIn("queue", [k.split(":")[0] for k in self.check({"overdue": 2, "owners": 3, "db_bytes": 1})])

    def test_each_users_step_crossed(self):
        self.assertEqual(self.check({"overdue": 0, "owners": 55, "db_bytes": 1}), ["users:20", "users:50"])

    def test_database_near_full(self):
        self.assertEqual([k.split(":")[0] for k in self.check({"overdue": 0, "owners": 1, "db_bytes": 450 * 2**20})],
                         ["db"])

    def test_all_quiet(self):
        self.assertEqual(self.check({"overdue": 0, "owners": 5, "db_bytes": 50 * 2**20}), [])
