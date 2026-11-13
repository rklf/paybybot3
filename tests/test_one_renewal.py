"""A renewal per vehicle, and a paid ticket recognised however PayByPhone writes the plate."""
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from paybybot3 import web


class OneRenewalPerVehicle(unittest.TestCase):
    def test_a_second_renewal_for_the_same_car_is_refused(self):
        s = web.UserSession("demo", "", demo=True)
        body = dict(location="75015", rate="101", duration=7, unit="Days", paymentAccountId="demo-card",
                    label="Riverain hebdo")
        with patch.object(web, "current", return_value=s):
            web.add_autopilot(web.Autopilot(plate="AB123CD", **body), "t")
            with self.assertRaises(HTTPException) as e:
                web.add_autopilot(web.Autopilot(plate="AB-123-cd", **body), "t")
        self.assertEqual(e.exception.status_code, 409)
        self.assertEqual(len(s.autopilots), 1)


class PaidTicketFound(unittest.TestCase):
    def test_plate_written_differently_or_found_by_session_id(self):
        s = web.UserSession("demo", "", demo=True)
        paid = {"parkingSessionId": "ps-1", "jobStatus": "completed"}
        for listed in ({"parkingSessionId": "ps-1", "vehicle": {"licensePlate": "other"}, "locationId": "x"},
                       {"parkingSessionId": "ps-2", "vehicle": {"licensePlate": "FT-630-FH"}, "locationId": 75005}):
            with patch.object(s.bot, "pay", return_value=paid), \
                    patch.object(s.bot, "get_parking_sessions", return_value=[listed]):
                result, found = web.pay_and_confirm(s, "75005", "1", 7, "Days", "FT630FH", "card")
            self.assertEqual(found, [listed])


if __name__ == "__main__":
    unittest.main()
