import unittest
from unittest.mock import patch

from paybybot3.bot import Bot


def job_request(amount):
    """The createJobV1 request sent for a ticket of this cost."""
    sent = {}

    def graphql(query, variables):
        sent.update(variables)
        return {"createJobV1": {"createJobResponse": {"jobId": "j"}}}

    with patch.object(Bot, "_graphql", side_effect=graphql):
        Bot.__new__(Bot)._create_job("s", "v", "t", False, "{}", amount=amount, paymentAccountId="card")
    return sent["input"]["request"]


class FreeTicket(unittest.TestCase):
    def test_a_free_ticket_is_sent_without_a_card(self):
        # Handi (CMI-S) costs 0 €: PayByPhone refuses a payment method then (UAPI-5100, « Payment Method must be
        # null when no line items have an amount »).
        self.assertNotIn("paymentMethod", job_request({"amount": 0, "currency": "EUR"}))

    def test_a_paid_ticket_keeps_its_card(self):
        request = job_request({"amount": 4.0, "currency": "EUR"})
        self.assertEqual(request["paymentMethod"]["paymentDetails"]["paymentAccountId"], "card")
