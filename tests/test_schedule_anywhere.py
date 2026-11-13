import unittest
from datetime import date, datetime, timezone

from paybybot3 import schedule


class Anywhere(unittest.TestCase):
    def test_sundays_and_holidays_free_in_paris_only(self):
        paris = {"days": [6], "start": "09:00", "unit": "Hours", "duration": 2, "location": "75016"}
        lyon = {**paris, "location": "69001"}
        sunday = date(2026, 11, 1)  # a Sunday, and All Saints' Day
        self.assertIsNone(schedule.slot_on(sunday, paris))
        self.assertIsNotNone(schedule.slot_on(sunday, lyon))

    def test_the_rule_s_time_zone(self):
        london = {"days": [0], "start": "09:00", "unit": "Hours", "duration": 1, "location": "1234", "tz": "Europe/London"}
        begin, end = schedule.slot_on(date(2026, 10, 26), london)
        self.assertEqual(begin.astimezone(timezone.utc), datetime(2026, 10, 26, 9, tzinfo=timezone.utc))
        self.assertEqual((end - begin).total_seconds(), 3600)

    def test_a_day_ticket_outside_paris_lasts_its_length(self):
        rule = {"days": [0], "start": "08:00", "unit": "Days", "duration": 1, "location": "69001"}
        begin, end = schedule.slot_on(date(2026, 10, 26), rule)
        self.assertEqual((end - begin).days, 1)

    def test_an_old_rule_without_zone_is_a_paris_one(self):
        self.assertTrue(schedule.in_paris({"days": [0]}))
        self.assertFalse(schedule.in_paris({"location": "1234"}))
