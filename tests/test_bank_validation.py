import base64
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from paybybot3 import web
from paybybot3.bot import Bot


def later(**k):
    return datetime.now(timezone.utc) + timedelta(**k)


class Base(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"PAYBYBOT_SECRET": "s" * 40})
        self.env.start()
        self.notified = []

    def tearDown(self):
        self.env.stop()

    def session(self, tickets):
        answers = {"get_parking_sessions": tickets,
                   "get_rate_options": [{"ratePolicyId": "101", "name": "Résident", "type": "Resident"}],
                   "get_payment_accounts": {"paymentCards": [{"paymentAccountId": "c"}]},
                   "get_job_challenge": {"pending": True, "url": "https://bank/x", "html": None}}
        s = MagicMock()
        s.call.side_effect = lambda name, *a, **k: answers.get(name)
        return s

    def run_renewal(self, tickets=(), pay_error=None, extend_error=None, last_error=None, **details):
        row = {"id": "r1", "owner": "o", "plate": "AB123CD", "location": "75005", "rate": "101", "duration": 7,
               "unit": "Days", "payment_account_id": "c", "last_error": last_error, "enabled": True, **details}
        stored = []
        with patch.object(web, "with_details", side_effect=lambda r: r), \
                patch.object(web, "guarded_state", return_value="ok"), \
                patch.object(web, "store", side_effect=lambda *a, **k: stored.append(k)), \
                patch.object(web, "notify") as mail, patch.object(web, "notify_bank") as bank, \
                patch.object(web.Bot, "from_refresh_token", return_value=MagicMock(refresh_token="t")), \
                patch.object(web.UserSession, "for_bot", return_value=self.session(list(tickets))), \
                patch.object(web, "pay_and_confirm", side_effect=pay_error or AssertionError("must not pay")) as pay, \
                patch.object(web, "extend_and_confirm", side_effect=extend_error or AssertionError("must not pay")) as ext:
            outcome = web.process_renewal(row, refresh_token="t")
        return outcome, stored[-1]["p_patch"], mail, bank, pay, ext

    def details(self, patch_):
        return json.loads(web._fernet("renewal").decrypt(patch_["data"].encode()))


class BankAsks(Base):
    def test_no_ticket_waits_a_day_and_tells_the_client(self):
        outcome, p, mail, _, _, _ = self.run_renewal(pay_error=web.BankCheck(web.BANK_CHECK, "job1"))
        self.assertEqual(outcome, "bank_wait")
        self.assertEqual(p["last_error"], web.BANK_WAIT)
        self.assertNotIn("enabled", p)  # never suspended at once any more
        d = self.details(p)
        self.assertEqual(d["bank_job"], "job1")
        self.assertEqual(d["bank_ends"], "")
        self.assertTrue(later(hours=23) < web.parse_dt(d["bank_deadline"]) < later(hours=25))
        self.assertTrue(later(hours=2) < web.parse_dt(p["next_check"]) < later(hours=4))  # the reminder
        self.assertEqual(mail.call_args.args[1], "problem")
        self.assertEqual(mail.call_args.kwargs["message"], web.BANK_WAIT)

    def test_a_running_week_gives_until_its_end(self):
        ends = later(hours=20)
        running = {"parkingSessionId": "s1", "locationId": "75005", "vehicle": {"licensePlate": "AB123CD"},
                   "expireTime": ends, "rateOptionId": "101"}
        with patch.object(web, "extendable", return_value=running), patch.object(web, "extension_time",
                                                                                  return_value=later(hours=-1)):
            outcome, p, _, _, _, _ = self.run_renewal([running], extend_error=web.BankCheck(web.BANK_CHECK, "job1"))
        self.assertEqual(outcome, "bank_wait")
        d = self.details(p)
        self.assertEqual(web.parse_dt(d["bank_deadline"]), ends)
        self.assertEqual(web.parse_dt(d["bank_ends"]), ends)
        self.assertTrue(later(hours=16) < web.parse_dt(p["next_check"]) < later(hours=18))

    def test_another_unconfirmed_payment_still_suspends_at_the_second_try(self):
        outcome, p, *_ = self.run_renewal(pay_error=web.Unconfirmed(web.UNCONFIRMED), last_error=web.UNCONFIRMED)
        self.assertEqual(outcome, "unconfirmed")
        self.assertFalse(p["enabled"])


class Waiting(Base):
    def wait(self, tickets=(), **details):
        base = {"bank_job": "job1", "bank_ends": "", "bank_deadline": web.utc_iso(later(hours=20)),
                "bank_remind": web.utc_iso(later(hours=-1)), "bank_reminded": ""}
        return self.run_renewal(tickets, last_error=web.BANK_WAIT, **{**base, **details})

    def test_never_pays_again_on_its_own_and_reminds_once(self):
        outcome, p, mail, bank, pay, ext = self.wait()
        self.assertEqual(outcome, "bank_wait")
        pay.assert_not_called()
        ext.assert_not_called()
        bank.assert_called_once()
        mail.assert_not_called()
        self.assertTrue(self.details(p)["bank_reminded"])
        self.assertTrue(later(hours=19) < web.parse_dt(p["next_check"]) < later(hours=21))

    def test_no_second_reminder(self):
        _, _, _, bank, _, _ = self.wait(bank_reminded="1")
        bank.assert_not_called()

    def test_not_time_to_remind_yet(self):
        remind = later(hours=2)
        _, p, _, bank, _, _ = self.wait(bank_remind=web.utc_iso(remind))
        bank.assert_not_called()
        self.assertEqual(web.parse_dt(p["next_check"]), remind)

    def test_suspended_at_the_deadline_with_the_reason(self):
        outcome, p, mail, *_ = self.wait(bank_deadline=web.utc_iso(later(minutes=-1)))
        self.assertEqual(outcome, "unconfirmed")
        self.assertFalse(p["enabled"])
        self.assertIn("suspendu", p["last_error"])
        self.assertTrue(mail.call_args.kwargs["suspended"])

    def test_validated_a_longer_ticket_is_a_payment(self):
        old = later(hours=1)
        ticket = {"parkingSessionId": "s1", "locationId": "75005", "vehicle": {"licensePlate": "AB123CD"},
                  "expireTime": later(days=7)}
        outcome, p, mail, *_ = self.wait([ticket], bank_ends=web.utc_iso(old))
        self.assertEqual(outcome, "paid")
        self.assertIsNone(p["last_error"])
        self.assertEqual(mail.call_args.args[1], "paid")

    def test_validated_a_ticket_appeared(self):
        ticket = {"parkingSessionId": "s1", "locationId": "75005", "vehicle": {"licensePlate": "AB123CD"},
                  "expireTime": later(days=7)}
        outcome, p, *_ = self.wait([ticket])
        self.assertEqual(outcome, "paid")
        self.assertIsNone(p["last_error"])

    def test_same_end_is_not_a_payment(self):
        ends = later(hours=5)
        ticket = {"parkingSessionId": "s1", "locationId": "75005", "vehicle": {"licensePlate": "AB123CD"},
                  "expireTime": ends}
        outcome, *_ = self.wait([ticket], bank_ends=web.utc_iso(ends))
        self.assertEqual(outcome, "bank_wait")


class Link(Base):
    def post(self, row, session=None, attempt=None):
        stored = []
        session = session or self.session([])

        def store(fn, **k):
            stored.append((fn, k))
            return {"renewal_list": [row], "renewal_get_credential": "cred", "usage_add": {}}.get(fn)
        with patch.object(web, "store", side_effect=store), patch.object(web, "guarded_state", return_value="ok"), \
                patch.object(web, "decrypt_credential", return_value="t"), \
                patch.object(web, "bot_from_refresh", return_value=MagicMock(refresh_token="t")), \
                patch.object(web.UserSession, "for_bot", return_value=session), \
                patch.object(web, "with_details", side_effect=lambda r: r), \
                patch.object(web, "notify"), patch.object(web, "process_renewal", side_effect=attempt) as process:
            answer = web.validate_payment(web.ValidateBody(t=web.validate_token("o", "r1")))
        return answer, stored, process

    def row(self, **k):
        return {"id": "r1", "owner": "o", "plate": "AB123CD", "location": "75005", "last_error": web.BANK_WAIT,
                "bank_job": "job1", "bank_ends": "", "enabled": True, **k}

    def test_a_bad_link_is_refused(self):
        with self.assertRaises(web.HTTPException):
            web.validate_payment(web.ValidateBody(t="nope"))

    def test_nothing_to_validate(self):
        answer, _, process = self.post(self.row(last_error=None))
        self.assertEqual(answer["status"], "done")
        process.assert_not_called()

    def test_the_waiting_payment_is_shown_not_paid_again(self):
        answer, stored, process = self.post(self.row())
        self.assertEqual(answer, {"status": "challenge", "url": "https://bank/x"})
        process.assert_not_called()
        self.assertIn("next_check", [k for fn, a in stored if fn == "renewal_update" for k in a["p_patch"]])

    def test_html_comes_signed(self):
        s = MagicMock()
        s.call.side_effect = lambda name, *a, **k: {"pending": True, "url": None, "html": "PGh0bWw+"} \
            if name == "get_job_challenge" else []
        answer, _, _ = self.post(self.row(), session=s)
        self.assertEqual(answer["html"], "PGh0bWw+")
        self.assertEqual(answer["sig"], web.challenge_sig("PGh0bWw+"))

    def test_too_late_for_that_payment_tries_again_with_the_client_there(self):
        s = MagicMock()
        answers = iter([{"pending": False}, {"pending": True, "url": "https://bank/new", "html": None}])
        s.call.side_effect = lambda name, *a, **k: next(answers) if name == "get_job_challenge" else []
        answer, _, process = self.post(self.row(), session=s, attempt=lambda *a, **k: "bank_wait")
        process.assert_called_once()
        self.assertTrue(process.call_args.kwargs["validating"])
        self.assertEqual(answer["url"], "https://bank/new")

    def test_paid_at_once(self):
        s = MagicMock()
        s.call.side_effect = lambda name, *a, **k: {"pending": False} if name == "get_job_challenge" else []
        answer, _, _ = self.post(self.row(), session=s, attempt=lambda *a, **k: "paid")
        self.assertEqual(answer["status"], "paid")

    def test_refused_after_too_many_tries(self):
        def store(fn, **k):
            return {"renewal_list": [self.row()], "usage_add": {k2: 99 for k2 in k.get("p_keys", [])}}.get(fn)
        with patch.object(web, "store", side_effect=store), patch.object(web, "with_details", side_effect=lambda r: r):
            with self.assertRaises(web.HTTPException) as refused:
                web.validate_payment(web.ValidateBody(t=web.validate_token("o", "r1")))
        self.assertEqual(refused.exception.status_code, 429)


class ChallengeRead(unittest.TestCase):
    def test_pending_with_its_page(self):
        job = {"captureGroups": [{"status": "authenticationChallengePending",
                                  "authentication": {"challengeUrl": "https://bank/x", "challengeHtml": None}}]}
        with patch.object(Bot, "_graphql", return_value={"getJobV1": job}):
            self.assertEqual(Bot.__new__(Bot).get_job_challenge("j"),
                             {"pending": True, "url": "https://bank/x", "html": None})

    def test_over(self):
        job = {"captureGroups": [{"status": "captured", "authentication": None}]}
        with patch.object(Bot, "_graphql", return_value={"getJobV1": job}):
            self.assertFalse(Bot.__new__(Bot).get_job_challenge("j")["pending"])


class Page(Base):
    def test_only_what_the_server_signed_is_shown_isolated(self):
        html = "PGh0bWw+"  # <html>
        answer = web.challenge_page_response(html, web.challenge_sig(html))
        self.assertEqual(answer.body, b"<html>")
        self.assertIn("sandbox", answer.headers["content-security-policy"])
        self.assertNotIn("allow-same-origin", answer.headers["content-security-policy"])
        with self.assertRaises(web.HTTPException):
            web.challenge_page_response(html, "faux")


class Push(Base):
    def test_only_real_push_services(self):
        ok = web.PushSub(endpoint="https://fcm.googleapis.com/fcm/send/x", keys={"p256dh": "a", "auth": "b"})
        self.assertEqual(ok.endpoint, "https://fcm.googleapis.com/fcm/send/x")
        for bad in ("http://fcm.googleapis.com/x", "https://evil.example/x", "https://169.254.169.254/x"):
            with self.assertRaises(Exception):
                web.PushSub(endpoint=bad, keys={"p256dh": "a", "auth": "b"})

    def test_a_gone_subscription_is_forgotten_and_nothing_raises(self):
        data = web._fernet("push").encrypt(json.dumps({"endpoint": "https://fcm.googleapis.com/x", "keys": {}}).encode()).decode()
        calls = []

        def store(fn, **k):
            calls.append(fn)
            return [data] if fn == "push_list" else None
        gone = web.requests.Response()
        gone.status_code = 410

        class WebPushException(Exception):
            response = gone
        with patch.object(web, "store", side_effect=store), patch.object(web, "webpush_send", side_effect=WebPushException()):
            web.send_push("o", "t", "b", "/")
        self.assertIn("push_delete", calls)

    def test_a_real_message_goes_out_encrypted_and_signed(self):
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        import base64
        browser = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        encode = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
        sub = {"endpoint": "https://fcm.googleapis.com/fcm/send/x", "keys": {"p256dh": encode(browser), "auth": encode(b"a" * 16)}}
        sent = web.requests.Response()
        sent.status_code = 201
        with patch("requests.post", return_value=sent) as post:
            web.webpush_send(sub, {"title": "t", "body": "b", "url": "/"})
        self.assertEqual(post.call_args.args[0], sub["endpoint"])
        headers = post.call_args.kwargs["headers"]
        self.assertIn("vapid", headers["authorization"].lower())
        self.assertIn(web.vapid_public_key(), headers["authorization"])
        self.assertNotIn(b"title", post.call_args.kwargs["data"])  # encrypted

    def test_the_key_is_stable(self):
        self.assertEqual(web.vapid_public_key(), web.vapid_public_key())
        self.assertGreater(len(web.vapid_public_key()), 80)


if __name__ == "__main__":
    unittest.main()


def encoded(html):
    return base64.b64encode(html.encode()).decode()


AUTO_FORM = """<html><body onload="document.forms[0].submit()">
<form method="POST" action="https://acs.bank.test/challenge"><input type="hidden" name="creq" value="SECRET"></form>
</body></html>"""


class ServerOpensBankPage(unittest.TestCase):
    def opened(self, page, *answers):
        http = MagicMock()
        http.headers = {}
        replies = iter(answers or [MagicMock(url="https://acs.bank.test/end", status_code=200, text="<p>Attente</p>")])
        http.get.side_effect = lambda *a, **k: next(replies)
        http.post.side_effect = lambda *a, **k: next(replies)
        with patch.object(web.requests, "Session", return_value=http):
            web.open_bank_page(page)
        return http

    def test_a_link_is_opened(self):
        http = self.opened({"url": "https://acs.bank.test/x", "html": None})
        self.assertEqual(http.get.call_args.args[0], "https://acs.bank.test/x")
        http.post.assert_not_called()

    def test_a_page_sending_itself_is_sent(self):
        http = self.opened({"url": None, "html": encoded(AUTO_FORM)})
        self.assertEqual(http.post.call_args.args[0], "https://acs.bank.test/challenge")
        self.assertEqual(http.post.call_args.kwargs["data"], {"creq": "SECRET"})

    def test_the_next_page_sending_itself_is_sent_too(self):
        first = MagicMock(url="https://acs.bank.test/a", status_code=200, text=AUTO_FORM)
        last = MagicMock(url="https://acs.bank.test/end", status_code=200, text="<p>Attente</p>")
        http = self.opened({"url": "https://acs.bank.test/x", "html": None}, first, last)
        http.post.assert_called_once()

    def test_stops_after_a_few_pages(self):
        loop = MagicMock(url="https://acs.bank.test/a", status_code=200, text=AUTO_FORM)
        http = self.opened({"url": "https://acs.bank.test/x", "html": None}, *[loop] * 20)
        self.assertEqual(http.get.call_count + http.post.call_count, web.BANK_HOPS)

    def test_nothing_the_card_holder_must_fill_or_choose_is_sent(self):
        for html in (AUTO_FORM.replace('type="hidden"', 'type="password"'),
                     AUTO_FORM.replace('</form>', '<input type="submit" value="Annuler"></form>'),
                     AUTO_FORM.replace('</form>', '<button>Annuler</button></form>'),
                     AUTO_FORM.replace('document.forms[0].submit()', '')):
            http = self.opened({"url": None, "html": encoded(html)})
            http.post.assert_not_called()

    def test_only_https(self):
        http = self.opened({"url": "http://acs.bank.test/x", "html": None})
        http.get.assert_not_called()
        http = self.opened({"url": None, "html": encoded(AUTO_FORM.replace("https://", "http://"))})
        http.post.assert_not_called()

    def test_never_presents_itself_as_a_phone(self):
        self.assertEqual(self.opened({"url": "https://acs.bank.test/x"}).headers["User-Agent"], "PayByBot")

    def test_the_logs_keep_no_content(self):
        with self.assertLogs(web.log, "INFO") as logs:
            self.opened({"url": None, "html": encoded(AUTO_FORM)})
        self.assertNotIn("SECRET", "\n".join(logs.output))
        self.assertNotIn("/challenge", "\n".join(logs.output))


class OnlyOnTheOwnersAccount(unittest.TestCase):
    def patch_for(self, owner, validating=False):
        session = MagicMock()
        session.call.return_value = {"pending": True, "url": "https://acs.bank.test/x", "html": None}
        row = {"id": "r1", "owner": owner}
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "s" * 40}), \
                patch.object(web, "admin_owners", return_value={"me"}), \
                patch.object(web, "open_bank_page") as opened:
            web.bank_wait_patch(session, row, "job1", None, datetime.now(timezone.utc), validating)
        return opened

    def test_the_owner(self):
        self.patch_for("me").assert_called_once()

    def test_a_client(self):
        self.patch_for("client").assert_not_called()

    def test_not_when_the_card_holder_is_opening_it(self):
        self.patch_for("me", validating=True).assert_not_called()

    def test_a_failure_changes_nothing(self):
        session = MagicMock()
        session.call.return_value = {"pending": True, "url": "https://acs.bank.test/x", "html": None}
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "s" * 40}), \
                patch.object(web, "admin_owners", return_value={"me"}), \
                patch.object(web, "open_bank_page", side_effect=OSError("down")):
            p = web.bank_wait_patch(session, {"id": "r1", "owner": "me"}, "job1", None, datetime.now(timezone.utc), False)
        self.assertEqual(p["last_error"], web.BANK_WAIT)
