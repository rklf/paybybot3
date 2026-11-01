import os
import unittest
from unittest.mock import MagicMock, patch

from paybybot3 import web

RATE = [{"ratePolicyId": "101", "name": "Résident", "type": "Resident"}]


def accounts(*cards):
    return {"paymentCards": list(cards)}


def card(id, last4="1111", expiry=(12, 2030)):
    return {"paymentAccountId": id, "cardType": "Visa", "maskedCardNumber": "******" + last4,
            "expiryMonth": expiry[0], "expiryYear": expiry[1]}


def session(acc):
    s = MagicMock()
    s.call.side_effect = lambda name, *a, **k: {"get_rate_options": RATE, "get_payment_accounts": acc}.get(name)
    return s


class BackupCardId(unittest.TestCase):
    def test_matches_the_card_by_its_last_four_digits(self):
        with patch.dict(os.environ, {"PAYBYBOT_BACKUP_CARD_LAST4": "4964"}):
            self.assertEqual(web.backup_card_id(accounts(card("c", "1111"), card("b", "4964"))), "b")

    def test_no_match_returns_none(self):
        with patch.dict(os.environ, {"PAYBYBOT_BACKUP_CARD_LAST4": "4964"}):
            self.assertIsNone(web.backup_card_id(accounts(card("c", "1111"))))

    def test_without_config_there_is_no_backup(self):
        with patch.dict(os.environ, {"PAYBYBOT_BACKUP_CARD_LAST4": ""}):
            self.assertIsNone(web.backup_card_id(accounts(card("b", "4964"))))


class Waterfall(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"PAYBYBOT_BACKUP_CARD_LAST4": "4964"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def pick(self, acc, current, avoid=False):
        return web.check_payable(session(acc), "75005", "101", "AB123CD", current, avoid=avoid)

    def test_starts_on_the_clients_card_not_the_backup(self):
        acc = accounts(card("c", "1111"), card("b", "4964"))
        self.assertEqual(self.pick(acc, "c"), "c")

    def test_a_refused_client_card_falls_back_to_the_backup_when_it_is_the_only_other(self):
        acc = accounts(card("c", "1111"), card("b", "4964"))
        self.assertEqual(self.pick(acc, "c", avoid=True), "b")

    def test_another_client_card_is_tried_before_the_backup(self):
        acc = accounts(card("c", "1111"), card("c2", "2222"), card("b", "4964"))
        self.assertEqual(self.pick(acc, "c", avoid=True), "c2")

    def test_the_backup_pays_when_the_client_has_no_card_of_their_own(self):
        acc = accounts(card("b", "4964"))
        self.assertEqual(self.pick(acc, "b"), "b")

    def test_an_expired_client_card_falls_back_to_the_backup(self):
        acc = accounts(card("c", "1111", expiry=(1, 2020)), card("b", "4964"))
        self.assertEqual(self.pick(acc, "c"), "b")


class DoesNotKeepTheBackup(unittest.TestCase):
    def test_the_backup_never_becomes_the_renewals_card(self):
        row = {"id": "r", "payment_account_id": "c"}
        patch_ = {}
        web.keep_other_card(row, "b", patch_, on_backup=True)
        self.assertNotIn("data", patch_)

    def test_a_real_other_client_card_is_still_kept(self):
        row = {"id": "r", "payment_account_id": "c", "owner": "o", "plate": "AB", "location": "75005",
               "rate": "101", "duration": 7, "unit": "Days"}
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "s" * 40}):
            patch_ = {}
            web.keep_other_card(row, "c2", patch_, on_backup=False)
            self.assertIn("data", patch_)


class Rebill(unittest.TestCase):
    def test_a_ticket_paid_on_the_backup_is_added_to_the_next_invoice(self):
        row = {"id": "r", "owner": "o"}
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk"}), \
                patch.object(web, "account_by_owner", return_value={"stripe_customer": "cus_1"}), \
                patch.object(web, "stripe") as stripe:
            web.rebill_backup(row, {"cost": {"amount": 9.0, "currency": "EUR"}})
        stripe.assert_called_once()
        self.assertEqual(stripe.call_args.args[:2], ("POST", "invoiceitems"))
        self.assertEqual(stripe.call_args.kwargs["customer"], "cus_1")
        self.assertEqual(stripe.call_args.kwargs["amount"], 900)
        self.assertEqual(stripe.call_args.kwargs["currency"], "eur")

    def test_the_invoice_line_gives_the_tickets_date(self):
        now = web.datetime(2026, 11, 5, 19, 30, tzinfo=web.timezone.utc)
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk"}), \
                patch.object(web, "account_by_owner", return_value={"stripe_customer": "cus_1"}), \
                patch.object(web, "stripe") as stripe:
            web.rebill_backup({"id": "r", "owner": "o"}, {"cost": {"amount": 9.0, "currency": "EUR"}}, now)
        self.assertIn("5 novembre 2026", stripe.call_args.kwargs["description"])

    def test_no_customer_means_nothing_is_billed(self):
        with patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk"}), \
                patch.object(web, "account_by_owner", return_value={}), \
                patch.object(web, "stripe") as stripe:
            web.rebill_backup({"id": "r", "owner": "o"}, {"cost": {"amount": 9.0, "currency": "EUR"}})
        stripe.assert_not_called()



class AdminSetting(unittest.TestCase):
    """The owner sets the backup card's last four digits on the admin page, no redeploy needed."""

    def setUp(self):
        web._backup_cache[:] = [0.0, None]
        self.addCleanup(lambda: web._backup_cache.__setitem__(slice(None), [0.0, None]))

    def test_the_admin_setting_is_used_online(self):
        with patch.object(web, "HOSTED", True), patch.dict(os.environ, {"PAYBYBOT_BACKUP_CARD_LAST4": ""}), \
                patch.object(web, "store", return_value={"backup_card_last4": "9385"}):
            self.assertEqual(web.backup_card_id(accounts(card("c", "1111"), card("b", "9385"))), "b")

    def test_no_setting_online_means_no_backup(self):
        with patch.object(web, "HOSTED", True), patch.dict(os.environ, {"PAYBYBOT_BACKUP_CARD_LAST4": ""}), \
                patch.object(web, "store", return_value={"backup_card_last4": None}):
            self.assertIsNone(web.backup_card_id(accounts(card("b", "9385"))))

    def test_the_setting_is_read_once_for_several_renewals(self):
        with patch.object(web, "HOSTED", True), \
                patch.object(web, "store", return_value={"backup_card_last4": "9385"}) as store:
            web.backup_card_id(accounts(card("b", "9385")))
            web.backup_card_id(accounts(card("b", "9385")))
        self.assertEqual(store.call_count, 1)

    def test_the_owner_saves_four_digits(self):
        with patch.object(web, "HOSTED", True), patch.object(web, "require_admin"), \
                patch.object(web, "store", return_value={"backup_card_last4": "9385"}) as store:
            answer = web.admin_backup_card_set(web.BackupCard(last4="9385"), pbb_admin="x")
        store.assert_called_once_with("backup_card_set", p_last4="9385")
        self.assertEqual(answer, {"last4": "9385"})

    def test_the_owner_can_remove_it(self):
        with patch.object(web, "HOSTED", True), patch.object(web, "require_admin"), \
                patch.object(web, "store", return_value={"backup_card_last4": None}) as store:
            answer = web.admin_backup_card_set(web.BackupCard(last4=None), pbb_admin="x")
        store.assert_called_once_with("backup_card_set", p_last4=None)
        self.assertEqual(answer, {"last4": None})

    def test_anything_but_four_digits_is_refused(self):
        for bad in ("938", "93855", "abcd", "5438650669359385"):
            with self.assertRaises(Exception):
                web.BackupCard(last4=bad)

    def test_the_owner_reads_it(self):
        with patch.object(web, "HOSTED", True), patch.object(web, "require_admin"), \
                patch.object(web, "store", return_value={"backup_card_last4": "9385", "failures": 0}):
            self.assertEqual(web.admin_backup_card(pbb_admin="x"), {"last4": "9385"})


if __name__ == "__main__":
    unittest.main()
