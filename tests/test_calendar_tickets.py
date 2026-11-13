"""Tickets chosen on the calendar: one day, or every day of a period, at the time chosen (Sundays free in Paris)."""
import unittest
from datetime import date, datetime, timedelta
from unittest.mock import patch

from fastapi import HTTPException

from paybybot3 import schedule, web
from paybybot3.schedule import PARIS, free_day

EVERY_DAY = list(range(7))


def rule(first, last, **extra):
    return {"days": EVERY_DAY, "start": "09:00", "unit": "Hours", "duration": 2, "location": "75017",
            "date_from": first, "date_to": last, **extra}



def coming_paid_day():
    """Two days or more ahead, never a Paris Sunday or public holiday (no ticket is taken on those)."""
    day = datetime.now(PARIS).date() + timedelta(days=2)
    while free_day(day):
        day += timedelta(days=1)
    return day

class Calendar(unittest.TestCase):
    def test_only_the_days_of_the_period(self):
        r = rule("2026-10-27", "2026-10-31")  # Tuesday to Saturday
        self.assertIsNone(schedule.slot_on(date(2026, 10, 26), r))
        self.assertIsNotNone(schedule.slot_on(date(2026, 10, 27), r))
        self.assertIsNotNone(schedule.slot_on(date(2026, 10, 31), r))
        self.assertIsNone(schedule.slot_on(date(2026, 11, 2), r))
        # after the last day, never again
        self.assertIsNone(schedule.next_slot(r, datetime(2026, 10, 31, 12, tzinfo=PARIS)))

    def test_sundays_and_holidays_stay_free_in_paris(self):
        r = rule("2026-10-31", "2026-11-02")  # Sat 31, Sun 1 (and All Saints' Day), Mon 2
        self.assertIsNone(schedule.slot_on(date(2026, 11, 1), r))
        nxt = schedule.next_slot(r, datetime(2026, 10, 31, 12, tzinfo=PARIS))
        self.assertEqual(nxt.astimezone(PARIS).date(), date(2026, 11, 2))

    def test_one_day_pays_once_then_stops(self):
        r = rule("2026-10-27", "2026-10-27")
        pay, _ = schedule.decide(r, datetime(2026, 10, 27, 9, 5, tzinfo=PARIS))
        self.assertTrue(pay)
        pay, nxt = schedule.decide(r, datetime(2026, 10, 27, 9, 6, tzinfo=PARIS),
                                   last_payment=datetime(2026, 10, 27, 9, 5, tzinfo=PARIS))
        self.assertFalse(pay)
        self.assertIsNone(nxt)

    def test_text_of_the_e_mail(self):
        self.assertEqual(web.rule_text(rule("2026-10-27", "2026-10-27")),
                         "le mardi 27 octobre, ticket de 2 heures pris à 9h")
        self.assertEqual(web.rule_text(rule("2026-10-26", "2026-10-31")),
                         "du lundi 26 octobre au samedi 31 octobre, ticket de 2 heures pris à 9h")

    def test_rule_of_reads_both_spellings(self):
        stored = web.rule_of({"days": EVERY_DAY, "date_from": "2026-10-27", "date_to": "2026-10-28"})
        demo = web.rule_of({"days": EVERY_DAY, "dateFrom": "2026-10-27", "dateTo": "2026-10-28"})
        self.assertEqual((stored["date_from"], stored["date_to"]), ("2026-10-27", "2026-10-28"))
        self.assertEqual((demo["date_from"], demo["date_to"]), ("2026-10-27", "2026-10-28"))

    def test_a_period_in_the_past_is_refused(self):
        s = web.UserSession("demo", "", demo=True)
        past = (datetime.now(PARIS).date() - timedelta(days=3)).isoformat()
        body = web.Autopilot(plate="AB123CD", location="75017", rate="102", duration=2, unit="Hours",
                             paymentAccountId="demo-card", label="Jours précis", days=EVERY_DAY,
                             dateFrom=past, dateTo=past, start="09:00")
        with patch.object(web, "current", return_value=s):
            with self.assertRaises(HTTPException) as e:
                web.add_autopilot(body, "t")
        self.assertEqual(e.exception.status_code, 400)

    def test_a_coming_day_is_kept_on_the_rule(self):
        s = web.UserSession("demo", "", demo=True)
        day = coming_paid_day().isoformat()
        body = web.Autopilot(plate="AB123CD", location="75017", rate="102", duration=2, unit="Hours",
                             paymentAccountId="demo-card", label="Jours précis", days=EVERY_DAY,
                             dateFrom=day, start="09:00")
        with patch.object(web, "current", return_value=s), patch.object(web, "run_autopilot"), \
                patch.object(web.threading, "Thread"):
            ap = web.add_autopilot(body, "t")
        self.assertEqual((ap["dateFrom"], ap["dateTo"]), (day, day))
        self.assertIsNotNone(web.with_next_ticket(ap)["nextTicket"])

    def test_a_time_already_past_today_is_refused(self):
        now = datetime(2026, 11, 2, 14, 30, tzinfo=PARIS)
        body = web.Autopilot(plate="AB123CD", location="78101", rate="102", duration=30, unit="Minutes",
                             paymentAccountId="demo-card", label="Jours précis", days=EVERY_DAY,
                             dateFrom="2026-11-02", dateTo="2026-11-02", start="09:00")
        with patch.object(web, "datetime", wraps=datetime) as clock:
            clock.now.return_value = now
            with self.assertRaises(HTTPException) as e:
                web.checked_days(body)
        self.assertEqual(e.exception.status_code, 400)
        self.assertIn("passé", e.exception.detail)

    def test_a_time_still_to_come_today_is_kept(self):
        now = datetime(2026, 11, 2, 8, 30, tzinfo=PARIS)
        body = web.Autopilot(plate="AB123CD", location="78101", rate="102", duration=30, unit="Minutes",
                             paymentAccountId="demo-card", label="Jours précis", days=EVERY_DAY,
                             dateFrom="2026-11-02", dateTo="2026-11-02", start="09:00")
        with patch.object(web, "datetime", wraps=datetime) as clock:
            clock.now.return_value = now
            days, start = web.checked_days(body)
        self.assertEqual(start, "09:00")

    def test_while_its_window_is_open_it_is_kept(self):
        now = datetime(2026, 11, 2, 9, 10, tzinfo=PARIS)
        body = web.Autopilot(plate="AB123CD", location="78101", rate="102", duration=30, unit="Minutes",
                             paymentAccountId="demo-card", label="Jours précis", days=EVERY_DAY,
                             dateFrom="2026-11-02", dateTo="2026-11-02", start="09:00")
        with patch.object(web, "datetime", wraps=datetime) as clock:
            clock.now.return_value = now
            days, _ = web.checked_days(body)
        self.assertTrue(days)


if __name__ == "__main__":
    unittest.main()


class Over(unittest.TestCase):
    """A calendar ticket is over once nothing is left to take: it frees the car and leaves the subscription."""
    DAY = "2026-10-27"  # a Tuesday

    def details(self, last_payment=None, **extra):
        return {"days": EVERY_DAY, "start": "09:00", "unit": "Hours", "duration": 2, "location": "75017",
                "date_from": self.DAY, "date_to": self.DAY, "last_payment": last_payment, **extra}

    def test_before_its_day_it_holds_the_car(self):
        self.assertFalse(web.rule_over(self.details(), datetime(2026, 10, 26, 12, tzinfo=PARIS)))

    def test_while_its_ticket_is_being_taken_it_holds_the_car(self):
        self.assertFalse(web.rule_over(self.details(), datetime(2026, 10, 27, 9, 2, tzinfo=PARIS)))

    def test_while_its_ticket_runs_it_holds_the_car(self):
        paid = datetime(2026, 10, 27, 9, 1, tzinfo=PARIS).isoformat()
        self.assertFalse(web.rule_over(self.details(paid), datetime(2026, 10, 27, 10, tzinfo=PARIS)))

    def test_once_its_ticket_ended_the_car_is_free(self):
        paid = datetime(2026, 10, 27, 9, 1, tzinfo=PARIS).isoformat()
        self.assertTrue(web.rule_over(self.details(paid), datetime(2026, 10, 27, 11, 30, tzinfo=PARIS)))
        self.assertTrue(web.rule_over(self.details(), datetime(2026, 10, 28, 8, tzinfo=PARIS)))  # never taken

    def test_a_weekly_rule_is_never_over(self):
        self.assertFalse(web.rule_over({"days": [1], "start": "09:00"}, datetime(2030, 1, 1, tzinfo=PARIS)))

    def test_an_over_rule_lets_a_new_ticket_be_programmed(self):
        s = web.UserSession("demo", "", demo=True)
        s.autopilots["old"] = {"plate": "AB123CD", **self.details(datetime(2020, 1, 7, 9, 1, tzinfo=PARIS).isoformat(),
                                                                   date_from="2020-01-07", date_to="2020-01-07")}
        self.assertEqual(web.renewed_plates(s), set())
