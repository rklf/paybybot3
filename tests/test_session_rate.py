import unittest

from paybybot3 import web


class SessionRate(unittest.TestCase):
    def test_only_a_resident_ticket_is_marked_resident(self):
        self.assertTrue(web.serialize_session({"ratePolicy": {"ratePolicyId": "1", "type": "Resident"}})["resident"])
        self.assertFalse(web.serialize_session({"ratePolicy": {"ratePolicyId": "2", "type": "Visitor"}})["resident"])
        self.assertIsNone(web.serialize_session({"ratePolicy": {"ratePolicyId": "3"}})["resident"])  # not said
