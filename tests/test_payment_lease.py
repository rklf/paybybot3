"""Never two payments at once for one renewal: every way that pays (the scheduler, « Activer », a relaunch, « payer
maintenant », « Valider mon paiement ») first takes the renewal's lease in the database, and lets go after."""
from types import SimpleNamespace
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from paybybot3 import web


class Leases:
    """A stand-in for the database: `held` keys are taken by someone else."""

    def __init__(self, held=(), rows=()):
        self.held, self.rows, self.calls = set(held), list(rows), []

    def __call__(self, fn, **k):
        self.calls.append((fn, k))
        if fn == "lease_take":
            if k["p_key"] in self.held:
                return False
            self.held.add(k["p_key"])
            return True
        if fn == "lease_drop":
            self.held.discard(k["p_key"])
            return None
        if fn == "renewal_claim_due":
            return self.rows
        return None


class Paying(unittest.TestCase):
    def test_taken_then_let_go(self):
        db = Leases()
        with patch.object(web, "store", side_effect=db):
            with web.paying("pay:a") as ok:
                self.assertTrue(ok)
                self.assertIn("pay:a", db.held)
        self.assertNotIn("pay:a", db.held)

    def test_let_go_even_when_the_payment_fails(self):
        db = Leases()
        with patch.object(web, "store", side_effect=db), self.assertRaises(RuntimeError):
            with web.paying("pay:a"):
                raise RuntimeError("x")
        self.assertNotIn("pay:a", db.held)

    def test_held_by_another(self):
        db = Leases(held={"pay:a"})
        with patch.object(web, "store", side_effect=db):
            with web.paying("pay:a") as ok:
                self.assertFalse(ok)
        self.assertIn("pay:a", db.held)  # someone else's: not let go

    def test_database_unreachable_does_not_stop_renewals(self):
        # A renewal missed (a fine for the client) is worse than the rare double the lease guards against.
        def down(fn, **k):
            raise RuntimeError("db down")
        with patch.object(web, "store", side_effect=down):
            with web.paying("pay:a") as ok:
                self.assertTrue(ok)


class Scheduler(unittest.TestCase):
    def test_a_renewal_being_paid_elsewhere_is_skipped(self):
        db = Leases(held={"pay:b"}, rows=[{"id": "a", "owner": "o1"}, {"id": "b", "owner": "o2"}])
        paid = []
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "t"}), patch.object(web, "HOSTED", True), \
                patch.object(web, "cron_authorized", return_value=True), patch.object(web, "store", side_effect=db), \
                patch.object(web, "process_renewal", side_effect=lambda row, **kw: paid.append(row["id"]) or "paid"), \
                patch.object(web, "run_dunning", return_value=0), patch.object(web, "check_capacity"), \
                patch.object(web, "run_probe", return_value=None):
            answer = web.cron_renew(SimpleNamespace(headers={}))
        self.assertEqual(paid, ["a"])
        self.assertIn("busy", answer["outcomes"])
        self.assertNotIn("pay:a", db.held)  # let go after paying


class Validate(unittest.TestCase):
    def test_a_second_click_while_paying_is_refused(self):
        row = {"id": "r1", "owner": "owner", "last_error": web.BANK_WAIT, "plate": "AB123CD"}
        db = Leases(held={"pay:r1"})

        def store(fn, **k):
            if fn == "renewal_list":
                return [row]
            if fn == "usage_add":
                return {}
            return db(fn, **k)
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "s" * 40}), patch.object(web, "store", side_effect=store), \
                patch.object(web, "with_details", side_effect=lambda r: r), \
                patch.object(web, "guarded_state", return_value="ok"), \
                patch.object(web, "process_renewal") as process, self.assertRaises(HTTPException) as e:
            web.validate_payment(web.ValidateBody(t=web.validate_token("owner", "r1")))
        self.assertEqual(e.exception.status_code, 409)
        process.assert_not_called()


if __name__ == "__main__":
    unittest.main()
