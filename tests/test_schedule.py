import unittest
from datetime import date, datetime, timezone

from paybybot3.schedule import PARIS, decide, easter, free_day, next_slot, next_ticket


def paris(*args):
    return datetime(*args, tzinfo=PARIS)


SATURDAY = {"days": [5], "start": "09:00", "unit": "Days", "duration": 1}
TUE_FRI = {"days": [1, 2, 3, 4], "start": "09:00", "unit": "Days", "duration": 1}
EVENING = {"days": [5], "start": "14:30", "unit": "Hours", "duration": 3}


class Holidays(unittest.TestCase):
    def test_easter(self):
        self.assertEqual(easter(2026), date(2026, 4, 5))
        self.assertEqual(easter(2027), date(2027, 3, 28))

    def test_free_days(self):
        self.assertTrue(free_day(date(2026, 10, 25)))  # Sunday
        self.assertTrue(free_day(date(2026, 11, 11)))  # Armistice, a Wednesday
        self.assertTrue(free_day(date(2026, 5, 14)))  # Ascension
        self.assertTrue(free_day(date(2026, 5, 25)))  # Whit Monday
        self.assertFalse(free_day(date(2026, 10, 24)))  # plain Saturday


class Decide(unittest.TestCase):
    def test_saturday_only(self):
        self.assertEqual(decide(SATURDAY, paris(2026, 10, 24, 9, 2)), (True, paris(2026, 10, 31, 9)))
        pay, nxt = decide(SATURDAY, paris(2026, 10, 23, 9, 2))  # Friday
        self.assertFalse(pay)
        self.assertEqual(nxt, paris(2026, 10, 24, 9))

    def test_before_and_after_the_window(self):
        self.assertFalse(decide(SATURDAY, paris(2026, 10, 24, 8, 59))[0])
        self.assertFalse(decide(SATURDAY, paris(2026, 10, 24, 20, 0))[0])  # paid parking is over
        self.assertTrue(decide(SATURDAY, paris(2026, 10, 24, 19, 59))[0])  # late check still pays

    def test_tuesday_to_friday(self):
        self.assertFalse(decide(TUE_FRI, paris(2026, 10, 19, 10))[0])  # Monday
        self.assertTrue(decide(TUE_FRI, paris(2026, 10, 20, 10))[0])
        self.assertTrue(decide(TUE_FRI, paris(2026, 10, 23, 10))[0])
        self.assertEqual(decide(TUE_FRI, paris(2026, 10, 23, 10))[1], paris(2026, 10, 27, 9))

    def test_public_holiday_skipped(self):
        self.assertFalse(decide(TUE_FRI, paris(2026, 11, 11, 10))[0])  # Wednesday 11 November
        self.assertEqual(next_slot(TUE_FRI, paris(2026, 11, 10, 10)), paris(2026, 11, 12, 9))

    def test_sunday_never(self):
        self.assertIsNone(next_slot({"days": [6], "unit": "Days"}, paris(2026, 10, 19)))

    def test_hours_slot(self):
        self.assertFalse(decide(EVENING, paris(2026, 10, 24, 14, 29))[0])
        self.assertTrue(decide(EVENING, paris(2026, 10, 24, 14, 31))[0])
        self.assertFalse(decide(EVENING, paris(2026, 10, 24, 17, 31))[0])

    def test_vacation_pause(self):
        start, end = paris(2026, 10, 24), paris(2026, 11, 2)
        pay, nxt = decide(SATURDAY, paris(2026, 10, 24, 10), paused_from=start, paused_until=end)
        self.assertFalse(pay)
        self.assertEqual(nxt, paris(2026, 11, 7, 9))
        self.assertTrue(decide(SATURDAY, paris(2026, 11, 7, 10), paused_from=start, paused_until=end)[0])
        self.assertFalse(decide(SATURDAY, paris(2026, 10, 24, 10), paused_from=start)[0])  # no end yet
        self.assertEqual(next_ticket(SATURDAY, paris(2026, 10, 20), start, end), paris(2026, 11, 7, 9))

    def test_ticket_already_running(self):
        now = paris(2026, 10, 24, 10)
        pay, nxt = decide(SATURDAY, now, covered_until=paris(2026, 10, 25, 9))
        self.assertFalse(pay)
        self.assertEqual(nxt, paris(2026, 10, 31, 9))
        # A ticket ending mid-window: look again right after it ends, then pay.
        pay, nxt = decide(SATURDAY, now, covered_until=paris(2026, 10, 24, 12))
        self.assertFalse(pay)
        self.assertEqual(nxt, paris(2026, 10, 24, 12, 0, 30))
        self.assertTrue(decide(SATURDAY, paris(2026, 10, 24, 12, 1), covered_until=paris(2026, 10, 24, 12))[0])

    def test_never_twice_in_a_window(self):
        paid = paris(2026, 10, 24, 9, 1)
        self.assertFalse(decide(SATURDAY, paris(2026, 10, 24, 15), last_payment=paid)[0])
        self.assertTrue(decide(SATURDAY, paris(2026, 10, 31, 9, 1), last_payment=paid)[0])

    def test_utc_and_naive_inputs(self):
        # 07:05 UTC = 09:05 Paris in summer time; PayByPhone returns naive UTC datetimes.
        self.assertTrue(decide(SATURDAY, datetime(2026, 10, 24, 7, 5, tzinfo=timezone.utc))[0])
        naive = datetime(2026, 10, 25, 7, 0)
        self.assertFalse(decide(SATURDAY, paris(2026, 10, 24, 10), covered_until=naive)[0])

    def test_daylight_saving_change(self):
        # Clocks go back on Sunday 25 October 2026: next Saturday 9:00 is 08:00 UTC.
        self.assertEqual(next_slot(SATURDAY, paris(2026, 10, 24, 10)).astimezone(timezone.utc),
                         datetime(2026, 10, 31, 8, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
