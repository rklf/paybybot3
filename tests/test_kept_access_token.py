import json
import time
import unittest
from unittest.mock import MagicMock, patch

import requests

from paybybot3 import web
from paybybot3.bot import Bot


def fake_store(cell):
    """renewal_get_credential / renewal_put_credential on one stored value."""
    def store(fn, **k):
        if fn == "renewal_get_credential":
            return cell.get("v")
        if fn == "renewal_put_credential":
            cell["v"] = k["p_credential"]
    return store


def logged_in(access="Bearer new", refresh="r2", expires=3600):
    bot = Bot.__new__(Bot)
    bot.authorization, bot.refresh_token, bot.expires_in = access, refresh, expires
    return bot


class KeptAccessToken(unittest.TestCase):
    """The renewals log in to PayByPhone once per access token, not once per run (every 5 minutes)."""

    def test_an_old_plain_credential_still_reads(self):
        cell = {"v": web.encrypt_credential("r1")}
        self.assertEqual(web.decrypt_credential(cell["v"]), "r1")
        with patch.object(web, "store", side_effect=fake_store(cell)):
            self.assertEqual(web.stored_refresh("o"), "r1")

    def test_a_login_keeps_its_access_token_and_the_next_run_uses_it_without_logging_in(self):
        cell = {"v": web.encrypt_credential("r1")}
        with patch.object(web, "store", side_effect=fake_store(cell)), \
                patch.object(Bot, "from_refresh_token", return_value=logged_in()) as login:
            web.bot_from_refresh("r1", "o")
            self.assertEqual(login.call_count, 1)
            self.assertEqual(web.decrypt_credential(cell["v"]), "r2")  # the refresh token as before
            again = web.bot_from_refresh("r1", "o")
            self.assertEqual(login.call_count, 1)  # no second login
        self.assertEqual((again.authorization, again.refresh_token), ("Bearer new", "r2"))

    def test_an_access_token_about_to_end_is_not_used(self):
        cell = {"v": web.encrypt_credential("r1", logged_in(expires=200))}  # under 5 minutes left
        with patch.object(web, "store", side_effect=fake_store(cell)), \
                patch.object(Bot, "from_refresh_token", return_value=logged_in("Bearer fresh")) as login:
            bot = web.bot_from_refresh("r1", "o")
        self.assertEqual(login.call_count, 1)
        self.assertEqual(bot.authorization, "Bearer fresh")

    def test_a_kept_token_refused_logs_in_again_once_and_the_call_goes_through(self):
        cell = {"v": web.encrypt_credential("r1", logged_in("Bearer stale"))}
        refused = MagicMock(status_code=401)
        ok = MagicMock(status_code=200)
        ok.json.return_value = {"data": {"getVehiclesV3": []}}
        sent = []

        def post(url, headers=None, **k):
            sent.append(headers.get("Authorization"))
            return refused if headers.get("Authorization") == "Bearer stale" else ok
        with patch.object(web, "store", side_effect=fake_store(cell)), \
                patch.object(Bot, "from_refresh_token", return_value=logged_in("Bearer fresh")) as login, \
                patch("paybybot3.bot.requests.post", side_effect=post):
            bot = web.bot_from_refresh("r1", "o")
            self.assertEqual(bot.get_vehicles(), [])
        self.assertEqual(login.call_count, 1)
        self.assertEqual(sent, ["Bearer stale", "Bearer fresh"])
        self.assertEqual(json.loads(web._fernet("credential").decrypt(cell["v"].encode()))["a"], "Bearer fresh")

    def test_a_refused_call_without_a_kept_token_raises_as_before(self):
        refused = MagicMock(status_code=401)
        refused.raise_for_status.side_effect = requests.HTTPError(response=refused)
        bot = logged_in()
        with patch("paybybot3.bot.requests.post", return_value=refused):
            with self.assertRaises(requests.HTTPError):
                bot.get_vehicles()
