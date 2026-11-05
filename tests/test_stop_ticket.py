import unittest
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
        self.assertTrue(self.shown()[a]["stoppable"])
        self.assertEqual(web.stop_tickets(web.StopTickets(ids=[a, b]))["stopped"], 2)
        self.assertEqual(self.shown(), {})

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
