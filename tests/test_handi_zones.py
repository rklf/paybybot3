import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from paybybot3 import web

PARIS = ["75001", "75002", "75016"]


def later(**k):
    return (datetime.now(timezone.utc) + timedelta(**k)).isoformat()


class FakeSession:
    """PayByPhone with a Handi rate in every zone (its own id there) and tickets already running in `running`."""

    demo = True

    def __init__(self, running=(), refuse=()):
        self.tickets = [{"locationId": z, "vehicle": {"licensePlate": "GJ124CQ"}, "expireTime": later(hours=10)}
                        for z in running]
        self.refuse, self.paid, self.attempts, self.unconfirmed = set(refuse), [], [], {}

    def log(self, kind, message):
        pass

    def call(self, name, *args, **kw):
        if name == "get_parking_sessions":
            return self.tickets
        if name == "get_rate_options":
            return [{"ratePolicyId": "v" + args[0], "name": "Visiteur", "type": "VIS"},
                    {"ratePolicyId": "h" + args[0], "name": "Handi - toutes zones", "type": "CUSTOM"}]
        if name == "pay":
            zone = kw["locationId"]
            if zone in self.refuse:
                raise RuntimeError("Quote error: PbpParkingNotAllowed")
            self.paid.append((zone, kw["ratePolicyId"]))
            ticket = {"parkingSessionId": zone, "locationId": zone, "vehicle": {"licensePlate": "GJ124CQ"},
                      "expireTime": later(hours=18)}
            self.tickets.append(ticket)
            return {"parkingSessionId": zone}
        raise AssertionError(name)


ROW = {"id": "r", "plate": "GJ-124-CQ", "location": "75016", "rate": "h75016", "duration": "1", "unit": "Days",
       "payment_account_id": "card", "locations": PARIS}


class TakeZones(unittest.TestCase):
    def test_one_handi_ticket_in_each_zone_with_its_own_rate(self):
        s = FakeSession()
        expire, failed, left = web.take_zones(s, ROW, "card")
        self.assertEqual(sorted(s.paid), [("75001", "h75001"), ("75002", "h75002"), ("75016", "h75016")])
        self.assertEqual((failed, left), ([], []))
        self.assertIsNotNone(expire)

    def test_a_zone_already_covered_is_left_alone(self):
        s = FakeSession(running=["75002"])
        web.take_zones(s, ROW, "card")
        self.assertEqual(sorted(z for z, _ in s.paid), ["75001", "75016"])

    def test_a_refused_zone_does_not_stop_the_others(self):
        s = FakeSession(refuse=["75001"])
        _, failed, _ = web.take_zones(s, ROW, "card")
        self.assertEqual(sorted(z for z, _ in s.paid), ["75002", "75016"])
        self.assertEqual([z for z, _ in failed], ["75001"])
        self.assertTrue(web.zones_error(failed).startswith("Non couverts : 1er (PayByPhone n'autorise pas"))

    def test_a_zone_still_parked_says_so(self):
        failed = [("75001", RuntimeError("Quote error: VehicleAlreadyParked")),
                  ("75004", RuntimeError("Quote error: VehicleAlreadyParked"))]
        self.assertEqual(web.zones_error(failed),
                         "Non couverts : 1er, 4e (un ticket y est encore en cours chez PayByPhone)")

    def test_the_zones_left_when_time_is_up(self):
        s = FakeSession()
        _, _, left = web.take_zones(s, ROW, "card", wave=0)
        self.assertEqual((s.paid, left), ([], PARIS))


class RenewZones(unittest.TestCase):
    def setUp(self):
        self.stored, self.mails = [], []
        for p in (patch.object(web, "store", side_effect=lambda fn, **kw: self.stored.append(kw["p_patch"])),
                  patch.object(web, "notify", side_effect=lambda row, event, **kw: self.mails.append(event))):
            p.start()
            self.addCleanup(p.stop)

    def test_every_zone_covered_counts_as_paid_with_one_email(self):
        outcome = web.renew_zones(FakeSession(), dict(ROW), None, datetime.now(timezone.utc), {}, None)
        self.assertEqual(outcome, "paid")
        self.assertIsNone(self.stored[0]["last_error"])
        self.assertIn("last_payment", self.stored[0])
        self.assertEqual(self.mails, ["paid"])

    def test_a_refused_zone_is_said_and_tried_again_without_counting_the_day(self):
        outcome = web.renew_zones(FakeSession(refuse=["75002"]), dict(ROW), None, datetime.now(timezone.utc), {}, None)
        self.assertEqual(outcome, "error")
        self.assertIn("2e", self.stored[0]["last_error"])  # « Non couverts : 2e (…) »
        self.assertNotIn("last_payment", self.stored[0])
        self.assertEqual(self.mails, ["problem"])

    def test_time_up_comes_back_in_a_minute(self):
        with patch.object(web, "ZONES_WAVE", 0):
            outcome = web.renew_zones(FakeSession(), dict(ROW), None, datetime.now(timezone.utc), {}, None)
        self.assertEqual(outcome, "partial")
        self.assertEqual(self.mails, [])


class Texts(unittest.TestCase):
    def test_where(self):
        self.assertEqual(web.zones_text({"locations": ["750%02d" % n for n in range(1, 21)]}), "tout Paris")
        self.assertEqual(web.zones_text({"locations": PARIS}), "3 arrondissements de Paris")
        self.assertEqual(web.zones_text({"location": "75016"}), "zone 75016")

    def test_only_a_handi_ticket_on_chosen_days_has_several_zones(self):
        body = web.Autopilot(location="75016", rate="h", duration=1, unit="Days", plate="X", paymentAccountId="c",
                             days=[0], start="05:00", cmis=True, locations=["75016", "75001", "75001"])
        self.assertEqual(web.zones_of(body, [0]), ["75001", "75016"])
        self.assertIsNone(web.zones_of(body.model_copy(update={"cmis": False}), [0]))


class ParisOnly(unittest.TestCase):
    def body(self, zone):
        return web.Autopilot(location=zone, rate="h", duration=1, unit="Days", plate="X", paymentAccountId="c",
                             days=[0], start="05:00", cmis=True)

    def test_the_cmis_ticket_is_refused_outside_paris(self):
        with self.assertRaises(web.HTTPException) as e:
            web.check_cmis_zone(self.body("69001"))
        self.assertIn("Paris seulement", e.exception.detail)

    def test_the_cmis_ticket_is_taken_in_paris(self):
        web.check_cmis_zone(self.body("75016"))


class FirstTicketNow(unittest.TestCase):
    """Programmed at 3 h for 5 h: nothing before 5 h, unless the first ticket is asked for at once."""

    def ap(self):
        return {"plate": "GJ-124-CQ", "location": "75016", "rate": "h75016", "duration": "1", "unit": "Days",
                "paymentAccountId": "card", "days": [0, 1, 2, 3, 4, 5, 6], "start": "05:00", "lastPayment": None}

    def at_3am(self):
        return datetime(2026, 11, 10, 2, 0, tzinfo=timezone.utc)  # a Tuesday, 3 h in Paris

    def test_waits_for_its_window(self):
        s, ap = FakeSession(), self.ap()
        web.run_autopilot(s, ap, now=self.at_3am())
        self.assertEqual(s.paid, [])

    def test_taken_at_once_when_asked(self):
        s, ap = FakeSession(), self.ap()
        web.run_autopilot(s, ap, now=self.at_3am(), first_now=True)
        self.assertEqual(s.paid, [("75016", "h75016")])
        self.assertIsNone(ap["lastError"])

    def test_never_over_a_running_ticket(self):
        s, ap = FakeSession(running=["75016"]), self.ap()
        web.run_autopilot(s, ap, now=self.at_3am(), first_now=True)
        self.assertEqual(s.paid, [])


class StoredZones(unittest.TestCase):
    def test_the_arrondissements_survive_the_encryption(self):
        with patch.dict(os.environ, {"PAYBYBOT_SECRET": "s" * 40}):
            row = {"id": "r", "data": web.encrypt_details({**ROW, "locations": PARIS})}
            self.assertEqual(web.with_details(row)["locations"], PARIS)
