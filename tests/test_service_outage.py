import json
import os
import unittest
from unittest.mock import patch

import requests

from paybybot3 import web


def http_error(code):
    response = requests.Response()
    response.status_code = code
    return requests.HTTPError(response=response)


class OutageKind(unittest.TestCase):
    def test_paybyphone_blocking_or_down_is_an_outage(self):
        for e in (http_error(403), http_error(429), http_error(503), requests.ConnectionError(), requests.Timeout()):
            self.assertTrue(web.is_outage(e), e)

    def test_the_users_own_problems_are_not(self):
        for e in (http_error(400), http_error(401), ValueError("Quote error"), Exception("Payment job failed")):
            self.assertFalse(web.is_outage(e), e)


class LoginUnanswered(unittest.TestCase):
    def test_paybyphone_down_at_login_is_counted_and_never_asks_to_log_in_again(self):
        row = {"id": "r1", "plate": "AB123CD", "location": "75016", "credential": "c", "email": "c@x.fr"}
        with patch.object(web, "with_details", side_effect=lambda r: r), patch.object(web, "rule_of", return_value=None), \
                patch.object(web, "paused_now", return_value=False), \
                patch.object(web, "decrypt_credential", return_value="refresh"), \
                patch.object(web, "bot_from_refresh", side_effect=requests.ConnectionError()), \
                patch.object(web, "store") as store, patch.object(web, "notify") as notify, \
                patch.object(web, "outage_hit") as hit:
            self.assertEqual(web.process_renewal(row), "unreachable")
        hit.assert_called_once()
        notify.assert_not_called()  # not « reconnectez-vous »: the user did nothing wrong
        self.assertNotIn("last_error", store.call_args.kwargs["p_patch"])


class OwnerAlerted(unittest.TestCase):
    def test_the_owner_hears_once_when_the_threshold_is_crossed(self):
        sent = []
        with patch.dict(os.environ, {"PAYBYBOT_ADMIN_EMAIL": "owner@x.fr"}), \
                patch.object(web, "send_email", side_effect=lambda to, *a, **k: sent.append(to)):
            with patch.object(web, "store", return_value={"failures": 2, "started": False}):
                web.outage_hit()
            with patch.object(web, "store", return_value={"failures": 3, "started": True}):
                web.outage_hit()
            with patch.object(web, "store", return_value={"failures": 4, "started": False}):
                web.outage_hit()
        self.assertEqual(sent, ["owner@x.fr"])


class CustomersWritten(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"})
        self.env.start()
        self.addCleanup(self.env.stop)
        key = web._fernet("account")
        self.accounts = [
            {"data": key.encrypt(json.dumps({"email": "a@x.fr"}).encode()).decode(), "renewals_active": 1},
            {"data": key.encrypt(json.dumps({"email": "A@x.fr"}).encode()).decode(), "renewals_active": 2},  # same
            {"data": key.encrypt(json.dumps({"email": "idle@x.fr"}).encode()).decode(), "renewals_active": 0},
            {"data": key.encrypt(json.dumps({}).encode()).decode(), "renewals_active": 1},  # no address
        ]

    def test_only_customers_with_something_running_once_each(self):
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "store", return_value=self.accounts):
            self.assertEqual(web.outage_recipients(), ["a@x.fr"])

    def test_the_interruption_mail_goes_once_then_the_resume_mail(self):
        sent, state = [], {"interrupted_at": "2026-10-27T10:00:00Z", "notified_at": None}

        def store(fn, **params):
            if fn == "admin_accounts":
                return self.accounts
            if fn == "service_state_get":
                return dict(state)
            if fn == "service_state_set":
                if params["p_action"] == "notified":
                    state["notified_at"] = "now"
                if params["p_action"] == "resume":
                    state.update(interrupted_at=None, notified_at=None)
                return dict(state)
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "store", side_effect=store), \
                patch.object(web, "send_email", side_effect=lambda to, subject, *a, **k: sent.append((to, subject))):
            web.service_action("notify")
            web.service_action("notify")  # a second click sends nothing more
            web.service_action("resume")
        self.assertEqual([s for _, s in sent], ["PayByBot interrompu · payez votre stationnement vous-même",
                                                "PayByBot fonctionne de nouveau"])

    def test_no_resume_mail_when_nobody_was_told(self):
        state = {"interrupted_at": "2026-10-27T10:00:00Z", "notified_at": None}
        with patch.object(web, "store", side_effect=lambda fn, **p: dict(state)), \
                patch.object(web, "send_email") as send:
            web.service_action("resume")
        send.assert_not_called()


class Banner(unittest.TestCase):
    def setUp(self):
        web._service_cache.update(at=0.0, value=False)

    def test_the_app_is_told_while_interrupted(self):
        with patch.object(web, "HOSTED", True), \
                patch.object(web, "store", return_value={"interrupted_at": "2026-10-27T10:00:00Z"}):
            self.assertTrue(web.config()["interrupted"])

    def test_not_interrupted_by_default(self):
        with patch.object(web, "HOSTED", True), patch.object(web, "store", return_value={"interrupted_at": None}):
            self.assertFalse(web.config()["interrupted"])


class ApiChanged(unittest.TestCase):
    def test_a_query_paybyphone_no_longer_understands_is_an_outage(self):
        for text in ('GraphQL error: [{"message": "Cannot query field \\"x\\" on type \\"Job\\"."}]',
                     'GraphQL error: [{"extensions": {"code": "GRAPHQL_VALIDATION_FAILED"}}]',
                     'GraphQL error: [{"message": "Unknown argument \\"y\\" on field \\"z\\"."}]'):
            self.assertTrue(web.is_outage(RuntimeError(text)), text)

    def test_an_answer_about_this_user_is_not(self):
        self.assertFalse(web.is_outage(RuntimeError('GraphQL error: [{"message": "Vehicle not found"}]')))
