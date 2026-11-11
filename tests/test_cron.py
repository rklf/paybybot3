from types import SimpleNamespace
import os
import unittest
from unittest.mock import patch

from paybybot3 import web


class Cron(unittest.TestCase):
    def test_due_renewals_run_side_by_side_and_one_failing_stops_none(self):
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "HOSTED", True), \
                patch.object(web, "cron_authorized", return_value=True), \
                patch.object(web, "store", return_value=[{"id": "a"}, {"id": "b"}, {"id": "c"}]), \
                patch.object(web, "process_renewal", side_effect=lambda row, **kw: {"b": RuntimeError("x")}.get(row["id"], "paid")
                             if row["id"] != "b" else (_ for _ in ()).throw(RuntimeError("x"))), \
                patch.object(web, "run_dunning", return_value=0):
            answer = web.cron_renew(SimpleNamespace(headers={}))
        self.assertEqual((answer["processed"], sorted(answer["outcomes"])), (3, ["error", "paid", "paid"]))

    def test_one_accounts_renewals_share_one_login(self):
        # Two logins at once with the same token make PayByPhone drop them all: one per account and per run.
        seen = []

        def renew(row, logins):
            seen.append((row["owner"], id(logins)))
            return "paid"
        rows = [{"id": "a", "owner": "o1"}, {"id": "b", "owner": "o1"}, {"id": "c", "owner": "o2"}]
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "HOSTED", True), \
                patch.object(web, "cron_authorized", return_value=True), patch.object(web, "store", return_value=rows), \
                patch.object(web, "process_renewal", side_effect=renew), patch.object(web, "run_dunning", return_value=0):
            web.cron_renew(SimpleNamespace(headers={}))
        by_owner = {}
        for owner, logins in seen:
            by_owner.setdefault(owner, set()).add(logins)
        self.assertEqual(len(by_owner["o1"]), 1)  # the same logins for both of o1's renewals
        self.assertNotEqual(by_owner["o1"], by_owner["o2"])


    def test_more_than_one_batch_when_many_are_due(self):
        # 4 at a time (PayByPhone's limits), but batch after batch while the run has time: not 4 every 5 minutes.
        batches = [[{"id": "a%d" % i, "owner": "o%d" % i} for i in range(4)],
                   [{"id": "b%d" % i, "owner": "p%d" % i} for i in range(4)], [{"id": "c0", "owner": "q0"}]]

        def store(fn, **k):
            return batches.pop(0) if fn == "renewal_claim_due" and batches else None
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "HOSTED", True), \
                patch.object(web, "cron_authorized", return_value=True), patch.object(web, "store", side_effect=store), \
                patch.object(web, "process_renewal", return_value="paid"), patch.object(web, "run_dunning", return_value=0):
            answer = web.cron_renew(SimpleNamespace(headers={}))
        self.assertEqual(answer["processed"], 9)

    def test_no_new_batch_late_in_the_run(self):
        # Past 50 seconds no batch starts: the function's limit (120 s) is never reached.
        claims = []

        def store(fn, **k):
            if fn == "renewal_claim_due":
                claims.append(1)
                return [{"id": "x%d" % (len(claims) * 10 + i), "owner": "o%d" % i} for i in range(4)]
        clock = iter([0, 10, 60, 70, 80])
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "HOSTED", True), \
                patch.object(web, "cron_authorized", return_value=True), patch.object(web, "store", side_effect=store), \
                patch.object(web, "process_renewal", return_value="paid"), patch.object(web, "run_dunning", return_value=0), \
                patch.object(web.time, "monotonic", side_effect=lambda: next(clock)):
            web.cron_renew(SimpleNamespace(headers={}))
        self.assertEqual(len(claims), 2)

if __name__ == "__main__":
    unittest.main()
