import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from paybybot3 import web


def demo_session():
    s = web.UserSession.for_bot(web.DemoBot())
    s.demo = True
    return s


class StopTicket(unittest.TestCase):
    def setUp(self):
        self.s = demo_session()
        p = patch.object(web, "current", return_value=self.s)
        p.start()
        self.addCleanup(p.stop)
        p = patch("time.sleep")  # the demo's payment delay
        p.start()
        self.addCleanup(p.stop)

    def take(self, rate):
        return self.s.call("pay", 1, "Days", "GH456JK", "75016", rate, "demo-card")["parkingSessionId"]

    def shown(self):
        return {x["id"]: x for x in map(web.serialize_session, self.s.call("get_parking_sessions"))}

    def cmis(self, *zones):
        self.s.autopilots["ap"] = {"plate": "GH-456-JK", "location": zones[0], "cmis": True,
                                   "locations": list(zones) if len(zones) > 1 else None}

    def test_a_handi_ticket_can_be_stopped(self):
        self.cmis("75016")
        a, b = self.take("105"), self.take("105")

    def test_a_handi_ticket_taken_in_the_app_too(self):
        a = self.take("105")  # no CMI-S ticket programmed on PayByBot
        self.assertEqual(web.stop_tickets(web.StopTickets(ids=[a]))["stopped"], 1)

    def test_handi_two(self):
        self.cmis("75016")
        a, b = self.take("105"), self.take("105")
        self.assertTrue(self.shown()[a]["stoppable"])
        self.assertEqual(web.stop_tickets(web.StopTickets(ids=[a, b]))["stopped"], 2)
        self.assertTrue(all(x["stopped"] and not x["stoppable"] for x in self.shown().values()))

    def test_a_resident_week_cannot(self):
        a = self.take("101")
        self.assertFalse(self.shown()[a]["stoppable"])
        with self.assertRaises(web.HTTPException) as e:
            web.stop_tickets(web.StopTickets(ids=[a]))
        self.assertIn("ne permet pas", e.exception.detail)
        self.assertIn(a, self.shown())

    def test_only_a_cmis_ticket_programmed_on_paybybot(self):
        a = self.take("102")  # a visitor ticket PayByPhone lets stop: not stopped by PayByBot
        with self.assertRaises(web.HTTPException):
            web.stop_tickets(web.StopTickets(ids=[a]))
        self.assertIn(a, self.shown())

    def test_without_the_stop_fields_no_button(self):
        self.assertFalse(web.serialize_session({"parkingSessionId": "x", "isStoppable": True})["stoppable"])


class StopFieldsRefused(unittest.TestCase):
    def test_the_ticket_list_still_comes(self):
        from paybybot3.bot import Bot
        asked = []

        def graphql(query, variables):
            asked.append("isStoppable" in query)
            if "isStoppable" in query:
                raise RuntimeError('GraphQL error: [{"message": "Cannot query field"}]')
            return {"getParkingSessionsV1": [{"parkingSessionId": "x", "startTime": None, "expireTime": None}]}

        with patch.object(Bot, "_graphql", side_effect=graphql):
            sessions = Bot.__new__(Bot)._get_parking_sessions()
        self.assertEqual((asked, [x["parkingSessionId"] for x in sessions]), ([True, False], ["x"]))


class TicketKind(unittest.TestCase):
    def test_the_rate_name_says_the_kind(self):
        s = demo_session()
        web.RATE_NAMES.clear()
        self.assertEqual(web.ticket_kind(s, "75016", "GH456JK", "105"), "Carte mobilité CMI-S")
        self.assertEqual(web.ticket_kind(s, "75016", "GH456JK", "104"), "Véhicule lourd")
        self.assertEqual(web.ticket_kind(s, "75016", "GH456JK", "102"), "Véhicule léger")
        with patch.object(s, "call", side_effect=AssertionError("asked again")):
            self.assertEqual(web.ticket_kind(s, "75016", "GH456JK", "102"), "Véhicule léger")  # kept



class StoppedTicket(unittest.TestCase):
    def ticket(self, **k):
        return {"parkingSessionId": "x", "locationId": "75001", "startTime": datetime(2026, 11, 6, 12, 35, tzinfo=timezone.utc),
                "expireTime": datetime(2026, 11, 7, 12, 35, tzinfo=timezone.utc), **k}

    def test_a_stopped_ticket_says_so(self):
        # As PayByPhone lists it after « Arrêter »: still current, its end unchanged, the stop time set.
        self.assertTrue(web.serialize_session(self.ticket(stopTime="2026-11-06T12:46:45.317Z"))["stopped"])

    def test_a_running_ticket_has_no_stop_time(self):
        self.assertFalse(web.serialize_session(self.ticket())["stopped"])
