import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import requests

from paybybot3 import web

MORNING = datetime(2026, 10, 31, 9, 0, tzinfo=timezone.utc)  # 10:00 in Paris
NIGHT = datetime(2026, 10, 31, 2, 0, tzinfo=timezone.utc)  # 03:00 in Paris
ENV = {"PAYBYBOT_PROBE_LOGIN": "0600000000", "PAYBYBOT_PROBE_PASSWORD": "not-a-real-one"}


class FakeBot:
    """The test account on PayByPhone: one call of each, read only."""

    calls = []
    vehicles = [{"vehicleId": "v1", "licensePlate": "AB123CD"}]
    accounts = {"paymentCards": [{"paymentAccountId": "c1", "expiryMonth": 4, "expiryYear": 2030}]}

    def __init__(self, login, password):
        self.calls.append("login")

    def get_vehicles(self):
        self.calls.append("vehicles")
        return self.vehicles

    def get_payment_accounts(self):
        self.calls.append("cards")
        return self.accounts

    def get_parking_sessions(self):
        self.calls.append("tickets")
        return []


class Probe(unittest.TestCase):
    def setUp(self):
        FakeBot.calls = []
        self.count = 1

    def run_probe(self, bot=FakeBot, now=MORNING, env=ENV):
        with patch.dict(os.environ, env), patch.object(web, "Bot", bot), \
                patch.object(web, "store", side_effect=lambda fn, p_keys: {k: self.count for k in p_keys}), \
                patch.object(web, "capacity_alert") as alert:
            result = web.run_probe(now)
        return result, alert

    def test_all_good_no_e_mail(self):
        result, alert = self.run_probe()
        self.assertEqual(result, "ok")
        self.assertEqual(FakeBot.calls, ["login", "vehicles", "cards", "tickets"])
        alert.assert_not_called()

    def test_nothing_without_a_test_account(self):
        with patch.dict(os.environ):
            os.environ.pop("PAYBYBOT_PROBE_LOGIN", None)
            os.environ.pop("PAYBYBOT_PROBE_PASSWORD", None)
            with patch.object(web, "Bot", FakeBot), patch.object(web, "store") as store:
                self.assertIsNone(web.run_probe(MORNING))
        store.assert_not_called()
        self.assertEqual(FakeBot.calls, [])

    def test_once_a_day(self):
        self.count = 2
        result, _ = self.run_probe()
        self.assertIsNone(result)
        self.assertEqual(FakeBot.calls, [])

    def test_only_from_8_in_the_morning(self):
        result, _ = self.run_probe(now=NIGHT)
        self.assertIsNone(result)
        self.assertEqual(FakeBot.calls, [])

    def assert_alerted(self, bot, *words):
        result, alert = self.run_probe(bot)
        self.assertEqual(result, "alert")
        alert.assert_called_once()
        key, _, lines = alert.call_args.args
        self.assertEqual(key, "probe:2026-10-31")
        for word in words:
            self.assertIn(word, " ".join(lines))
        self.assertNotIn(ENV["PAYBYBOT_PROBE_PASSWORD"], " ".join(lines))

    def test_a_400_or_a_changed_api_alerts(self):
        class Refused(FakeBot):
            def get_vehicles(self):
                response = requests.Response()
                response.status_code = 400
                raise requests.HTTPError("400 Client Error", response=response)
        self.assert_alerted(Refused, "véhicules", "400")

    def test_a_graphql_error_alerts(self):
        class Changed(FakeBot):
            def get_payment_accounts(self):
                raise RuntimeError('GraphQL error: [{"message": "Cannot query field expiryMonth"}]')
        self.assert_alerted(Changed, "cartes", "expiryMonth")

    def test_a_refused_login_alerts(self):
        class NoLogin(FakeBot):
            def __init__(self, login, password):
                raise requests.ConnectionError("down")
        self.assert_alerted(NoLogin, "connexion")

    def test_a_phone_login_is_tried_in_international_format_like_the_app(self):
        class International(FakeBot):
            def __init__(self, login, password):
                if not login.startswith("+33"):
                    response = requests.Response()
                    response.status_code = 400
                    raise requests.HTTPError("400 Client Error", response=response)
                super().__init__(login, password)
        result, alert = self.run_probe(International)
        self.assertEqual(result, "ok")
        alert.assert_not_called()

    def test_a_field_gone_alerts(self):
        class NoPlate(FakeBot):
            vehicles = [{"vehicleId": "v1", "licensePlate": None}]
        self.assert_alerted(NoPlate, "véhicules", "licensePlate")

    def test_cards_in_another_shape_alert(self):
        class NoCards(FakeBot):
            accounts = {}
        self.assert_alerted(NoCards, "cartes", "paymentCards")

    def test_an_empty_test_account_is_fine(self):
        class Empty(FakeBot):
            vehicles = []
            accounts = {"paymentCards": []}
        self.assertEqual(self.run_probe(Empty)[0], "ok")

    def test_never_raises(self):
        with patch.dict(os.environ, ENV), patch.object(web, "store", side_effect=RuntimeError("down")):
            self.assertIsNone(web.run_probe(MORNING))


if __name__ == "__main__":
    unittest.main()
