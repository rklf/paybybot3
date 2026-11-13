"""Renewal dead ends: an expired login is told with until when the car is covered (and again before that end), an API
refusal is never blamed on the password, and a login renewed in the background is kept for the right account."""
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import MagicMock, patch

import requests

from paybybot3 import web

NOW = datetime(2026, 11, 12, 18, 0, tzinfo=timezone.utc)


def http_error(status, url):
    response = MagicMock(status_code=status, url=url)
    return requests.HTTPError(response=response)


class Messages(unittest.TestCase):
    def test_a_refused_api_call_is_not_a_wrong_password(self):
        self.assertNotIn("mot de passe", web.friendly_error(http_error(400, "https://api.paybyphone.com/graphql")))
        self.assertIn("mot de passe", web.friendly_error(http_error(400, "https://auth.paybyphoneapis.com/consumer/token")))


class Relogin(unittest.TestCase):
    def run_once(self, previous, ends):
        row = {"id": "r1", "owner": "o", "credential": "c", "last_error": previous, "enabled": True, "data": "x"}
        details = {"plate": "AB123CD", "location": "75001", "rate": "1", "duration": "7", "unit": "Days",
                   "paid": [{"until": web.utc_iso(ends)}]}
        sent = []

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return NOW

        with patch.object(web, "datetime", Clock), patch.object(web, "guarded_state", return_value="ok"), \
                patch.object(web, "decrypt_credential", return_value="refresh"), \
                patch.object(web, "bot_from_refresh", side_effect=RuntimeError("revoked")), \
                patch.object(web, "is_outage", return_value=False), patch.object(web, "store"), \
                patch.object(web, "decrypt_details", return_value=details), \
                patch.object(web, "notify", side_effect=lambda row, event, **info: sent.append(info)):
            outcome = web.process_renewal(row)
        return outcome, sent

    def test_told_with_the_end_then_again_before_it(self):
        _, first = self.run_once(None, NOW + timedelta(days=3))
        self.assertEqual(len(first), 1)
        self.assertIsNotNone(first[0]["ends"])
        _, quiet = self.run_once(web.RELOGIN, NOW + timedelta(days=3))
        self.assertEqual(quiet, [])
        _, last = self.run_once(web.RELOGIN, NOW + timedelta(hours=3))
        self.assertEqual(len(last), 1)


class BackgroundLogin(unittest.TestCase):
    def test_a_renewed_login_is_kept_for_the_renewal_owner(self):
        bot = MagicMock()
        bot.get_vehicles.side_effect = [requests.HTTPError(response=MagicMock(status_code=401)), []]
        s = web.UserSession.for_bot(bot, owner="owner-1")
        with patch.object(web, "HOSTED", True), patch.object(web, "bot_from_refresh", return_value=bot) as again:
            s.call("get_vehicles")
        self.assertEqual(again.call_args.args[1], "owner-1")


if __name__ == "__main__":
    unittest.main()
