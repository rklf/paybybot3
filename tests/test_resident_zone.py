import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from paybybot3 import web

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


def ticket(zone, hours, ago_days=1, plate="AB123CD"):
    start = NOW - timedelta(days=ago_days)
    return {"locationId": zone, "startTime": start, "expireTime": start + timedelta(hours=hours),
            "vehicle": {"licensePlate": plate}}


class ResidentZone(unittest.TestCase):
    def zone_with(self, sessions, resident_zones=None):
        s = web.UserSession("demo", "", demo=True)
        s.bot.get_past_sessions = lambda limit=20: sessions
        if resident_zones is not None:  # only these zones offer the resident rate
            rates = web.DemoBot().get_rate_options
            s.bot.get_rate_options = lambda zone, plate: [
                r for r in rates(zone, plate) if r["type"] != "Resident" or zone in resident_zones]
        with patch.object(web, "current", return_value=s):
            return web.resident_zone("token")["zone"]

    def test_a_week_ticket_gives_the_zone(self):
        self.assertEqual(self.zone_with([ticket("75008", 2), ticket("75017", 168, ago_days=9)]), "75017")

    def test_a_long_ticket_without_resident_rate_is_skipped(self):
        # A day ticket in a car park (33880) is not the home zone: only the zone offering the resident rate is.
        sessions = [ticket("33880", 24), ticket("75008", 2, ago_days=3), ticket("75017", 3, ago_days=6)]
        self.assertEqual(self.zone_with(sessions, resident_zones={"75017"}), "75017")

    def test_no_resident_zone(self):
        self.assertIsNone(self.zone_with([ticket("33880", 24)], resident_zones=set()))

    def test_not_in_the_history_found_arrondissement_by_arrondissement(self):
        self.assertEqual(self.zone_with([], resident_zones={"75011"}), "75011")
        self.assertEqual(self.zone_with([ticket("33880", 24)], resident_zones={"75017"}), "75017")

    def test_each_vehicle_gets_its_own_arrondissement_kept_on_the_account(self):
        s = web.UserSession("demo", "", demo=True)
        cards = {"AB123CD": "75011", "EF456GH": "75017"}  # resident cards in two arrondissements
        rates = web.DemoBot().get_rate_options
        calls = []

        def only_there(zone, plate):
            calls.append(zone)
            return [r for r in rates(zone, plate) if r["type"] != "Resident" or cards.get(plate) == zone]
        s.bot.get_rate_options = only_there
        s.bot.get_past_sessions = lambda limit=20: []
        s.bot.get_vehicles = lambda: [{"vehicleId": "v1", "licensePlate": "AB123CD", "type": "Car"},
                                      {"vehicleId": "v2", "licensePlate": "EF456GH", "type": "Car"}]
        found = web.vehicle_zones(s)
        self.assertEqual({v["licensePlate"]: z for v, z, _ in found}, cards)
        self.assertEqual(s.account["vehicle_zones"]["EF456GH"]["z"], "75017")
        calls.clear()
        web.vehicle_zones(s)  # kept: one check per vehicle, no new search
        self.assertEqual(sorted(calls), ["75011", "75017"])

    def test_sign_up_refused_without_a_resident_vehicle(self):
        s = web.UserSession("demo", "", demo=True)
        s.bot.get_rate_options = lambda zone, plate: [r for r in web.DemoBot().get_rate_options(zone, plate)
                                                      if r["type"] != "Resident"]
        self.assertIsNone(web.resident_home_zone(s))
        self.assertEqual(s.account, {})  # nothing kept

    def test_demo_week_price(self):
        self.assertEqual(web.DemoBot()._price("101", 7, "Days"), 9)
        self.assertEqual(web.DemoBot()._price("101", 1, "Days"), 1.5)


class FriendlyError(unittest.TestCase):
    def test_graphql_errors_are_not_shown_raw(self):
        raw = Exception('GraphQL error: [{"message": "A downstream service error occurred", "path": ["getRateOptionsV1"]}]')
        self.assertNotIn("GraphQL", web.friendly_error(raw))
        self.assertIn("zone", web.friendly_error(raw))
        self.assertNotIn("GraphQL", web.friendly_error(Exception('GraphQL error: [{"path": ["other"]}]')))


class FirstName(unittest.TestCase):
    def with_claims(self, claims):
        import base64, json
        payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
        s = web.UserSession.__new__(web.UserSession)
        s.demo = False
        s.bot = type("B", (), {"authorization": "Bearer h.%s.sig" % payload})()
        return web.first_name(s)

    def test_reads_the_first_name_when_given(self):
        self.assertEqual(self.with_claims({"given_name": "David"}), "David")
        self.assertEqual(self.with_claims({"name": "David Guenoun"}), "David")

    def test_never_shows_a_phone_or_email(self):
        self.assertIsNone(self.with_claims({"name": "+33612345678"}))
        self.assertIsNone(self.with_claims({"name": "a@b.fr"}))
        self.assertIsNone(self.with_claims({}))


if __name__ == "__main__":
    unittest.main()
