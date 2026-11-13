import hashlib
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from paybybot3 import web

SUPABASE, VERCEL = "supabase-token", "vercel-secret"
ENV = {"PAYBYBOT_CRON_TOKEN_SHA256": hashlib.sha256(SUPABASE.encode()).hexdigest(), "CRON_SECRET": VERCEL}


def call(token, minute=0, env=ENV):
    request = MagicMock()
    request.headers = {"authorization": "Bearer " + token}
    at = datetime(2026, 11, 10, 5, minute, tzinfo=timezone.utc)
    with patch.object(web, "HOSTED", True), patch.dict(os.environ, env, clear=False), \
            patch.object(web, "store", return_value=[]), patch.object(web, "check_capacity"), \
            patch.object(web, "run_probe", return_value=None), patch.object(web, "run_dunning", return_value=0) as dunning, \
            patch.object(web, "datetime", wraps=datetime) as clock:
        clock.now.return_value = at
        web.cron_renew(request)
    return dunning.call_count


class DunningOnce(unittest.TestCase):
    """The grace-week e-mails go out once: Supabase's scheduler and Vercel's daily cron both call at 5:00."""

    def test_supabase_s_call_sends_them(self):
        self.assertEqual(call(SUPABASE), 1)

    def test_vercel_s_daily_call_does_not(self):
        self.assertEqual(call(VERCEL), 0)

    def test_vercel_sends_them_when_it_is_the_only_scheduler(self):
        self.assertEqual(call(VERCEL, env={"PAYBYBOT_CRON_TOKEN_SHA256": "", "CRON_SECRET": VERCEL}), 1)

    def test_not_outside_the_hour_s_first_minutes(self):
        self.assertEqual(call(SUPABASE, minute=7), 0)
