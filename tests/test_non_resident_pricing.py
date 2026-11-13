"""The pricing lists every vehicle of an account without a resident rate (zone None): the offer screen, the
dashboard and « Mon compte » rely on it."""
import time
import unittest
from unittest.mock import patch

from paybybot3 import web

PLATES = ["AB123CD", "EF456GH", "IJ789KL"]


def non_resident(rates):
    s = web.UserSession("demo", "", demo=True)
    s.demo = False  # the demo bot, priced as a real account (not hosted: the account stays in memory)
    s.bot.get_vehicles = lambda: [{"vehicleId": p, "licensePlate": p, "type": "Car", "archived": False} for p in PLATES]
    s.bot.get_rate_options = rates
    s.bot.get_parking_sessions = lambda *a, **k: []
    return s


def visitor_only(zone, plate=None, *a, **k):
    return [{"ratePolicyId": "1", "name": "Visiteur", "type": "Visitor"}]


def no_rate_here(zone, plate=None, *a, **k):  # what PayByPhone answers where this vehicle has no rate at all
    raise RuntimeError('GraphQL error: [{"message": "No rate", "path": ["getRateOptions"]}]')


class NonResidentPricing(unittest.TestCase):
    def pricing(self, s):
        with patch.object(web, "current", return_value=s), patch.object(web, "reprice", return_value=False):
            return web.pricing(None)

    def assert_every_vehicle(self, p):
        self.assertEqual([v["plate"] for v in p["vehicles"]], PLATES)
        self.assertTrue(all(v["zone"] is None for v in p["vehicles"]))
        self.assertFalse(p["resident"])
        self.assertEqual(p["monthly"], web.MONTHLY_PRICE)

    def test_zones_already_kept_as_none(self):
        s = non_resident(visitor_only)
        web.save_account(s, {"vehicle_zones": {p: {"z": None, "t": int(time.time())} for p in PLATES}})
        self.assert_every_vehicle(self.pricing(s))

    def test_zones_looked_for_again(self):
        s = non_resident(visitor_only)
        web.save_account(s, {"vehicle_zones": {p: {"z": None, "t": 0} for p in PLATES}})
        self.assert_every_vehicle(self.pricing(s))

    def test_payByPhone_refusing_the_rates_of_a_kept_or_home_zone(self):
        s = non_resident(no_rate_here)
        web.save_account(s, {"zone": "75011", "vehicle_zones": {PLATES[0]: {"z": "75011", "t": 0}}})
        self.assert_every_vehicle(self.pricing(s))

    def test_vehicles_listed_when_payByPhone_is_busy(self):
        def busy(zone, plate=None, *a, **k):
            raise RuntimeError("PayByPhone answered 429")
        s = non_resident(busy)
        web.save_account(s, {"zone": "75011", "vehicle_zones": {PLATES[0]: {"z": "75011", "t": 0}}})
        with self.assertLogs(web.log.name, "WARNING"):
            self.assert_every_vehicle(self.pricing(s))
        self.assertNotIn("price_zone", web.load_account(s))  # nothing kept from an answer without the zones


if __name__ == "__main__":
    unittest.main()
