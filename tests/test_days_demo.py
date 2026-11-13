"""The "precise days" renewal end to end with the demo bot (no PayByPhone account needed)."""
import unittest
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError

from paybybot3.schedule import PARIS
from paybybot3.web import Autopilot, UserSession, rule_text, run_autopilot, with_next_ticket

PAST_SATURDAY = datetime(2026, 10, 17, 10, tzinfo=PARIS)


def demo_rule(days, **extra):
    s = UserSession("demo", "", demo=True)
    ap = {"id": "t1", "label": "Riverain jours", "plate": "AB123CD", "location": "75015", "rate": "101",
          "duration": 1, "unit": "Days", "paymentAccountId": "demo-card", "enabled": True, "lastPayment": None,
          "lastError": None, "days": days, "start": "09:00", **extra}
    s.autopilots[ap["id"]] = ap
    return s, ap


class DemoDays(unittest.TestCase):
    def test_pays_on_a_chosen_day_once(self):
        s, ap = demo_rule([5])
        run_autopilot(s, ap, now=PAST_SATURDAY)
        self.assertEqual(len(s.bot.sessions), 1)
        run_autopilot(s, ap, now=PAST_SATURDAY + timedelta(minutes=5))
        self.assertEqual(len(s.bot.sessions), 1)  # never twice

    def test_existing_ticket_is_kept(self):
        s, ap = demo_rule([5])
        s.bot.pay(1, "Days", "AB123CD", "75015", "101", "demo-card")
        run_autopilot(s, ap, now=PAST_SATURDAY)
        self.assertEqual(len(s.bot.sessions), 1)

    def test_other_days_sundays_and_pause(self):
        s, ap = demo_rule([1, 2, 3, 4])
        run_autopilot(s, ap, now=PAST_SATURDAY)
        run_autopilot(s, ap, now=PAST_SATURDAY + timedelta(days=1))
        self.assertEqual(s.bot.sessions, [])
        ap.update(pausedFrom=(PAST_SATURDAY - timedelta(days=1)).isoformat(), pausedUntil=None)
        run_autopilot(s, ap, now=PAST_SATURDAY + timedelta(days=3))  # a Tuesday, paused
        self.assertEqual(s.bot.sessions, [])

    def test_next_ticket_and_text(self):
        _, ap = demo_rule([5])
        nxt = datetime.fromisoformat(with_next_ticket(ap)["nextTicket"]).astimezone(PARIS)
        self.assertEqual((nxt.weekday(), nxt.hour), (5, 9))
        self.assertEqual(rule_text({"days": [5], "start": "09:00", "unit": "Days"}),
                         "chaque samedi, ticket d'une journée pris à 9h")
        self.assertEqual(rule_text({"days": [1, 2, 3, 4], "start": "14:30", "unit": "Hours", "duration": 3}),
                         "du mardi au vendredi, ticket de 3 heures pris à 14h30")

    def test_weekly_mode_unchanged(self):
        s, ap = demo_rule(None, duration=7)
        run_autopilot(s, ap, now=datetime.now(timezone.utc))
        self.assertEqual(len(s.bot.sessions), 1)
        self.assertIsNone(with_next_ticket(ap)["nextTicket"])

    def test_validation(self):
        base = {"location": "75015", "rate": "101", "duration": 1, "unit": "Days", "plate": "AB123CD",
                "paymentAccountId": "x"}
        self.assertEqual(Autopilot(**base, days=[1, 4], start="09:30").days, [1, 4])
        self.assertEqual(Autopilot(**base, days=[6]).days, [6])  # Sundays: paid outside Paris
        for bad in ({"days": [7]}, {"days": []}, {"days": [1], "start": "25:00"}, {"days": [1], "tz": "../etc"}):
            with self.assertRaises(ValidationError):
                Autopilot(**base, **bad)


if __name__ == "__main__":
    unittest.main()
