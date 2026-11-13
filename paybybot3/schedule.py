"""When a "precise days" renewal should take a ticket (like Frequens: "every Saturday", "Tuesday to Friday").

Pure functions, no PayByPhone or database access, so the decision can be tested on its own.
Days are numbered like ``date.weekday()``: 0 = Monday ... 6 = Sunday. Times are local to the rule (its "tz",
Paris by default). In Paris (zones 75xxx), street parking is free on Sundays and French public holidays: no
ticket is taken then. Elsewhere PayByPhone works the same everywhere, so every chosen day is taken.
"""

from datetime import date, datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

PARIS = ZoneInfo("Europe/Paris")
DEFAULT_START = "09:00"  # paid parking in Paris starts at 9:00...
PAID_UNTIL = dtime(20)  # ...and ends at 20:00
SUNDAY = 6


def easter(year):
    """Gregorian Easter Sunday (anonymous algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = divmod(b, 4)
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 19 * l) // 433
    month = (h + l - 7 * m + 90) // 25
    return date(year, month, (h + l - 7 * m + 33 * month + 19) % 32)


def french_holidays(year):
    e = easter(year)
    fixed = [(1, 1), (5, 1), (5, 8), (7, 14), (8, 15), (11, 1), (11, 11), (12, 25)]
    return {date(year, m, d) for m, d in fixed} | {e + timedelta(days=1), e + timedelta(days=39), e + timedelta(days=50)}


def free_day(day):
    """Sundays and public holidays: parking is free in Paris."""
    return day.weekday() == SUNDAY or day in french_holidays(day.year)


def in_paris(rule):
    """A Paris zone (75001 to 75020, 75116): Sundays and holidays free, paid parking until 20:00. A rule saved
    before zones were kept is a Paris one (PayByBot was Paris only)."""
    zone = str(rule.get("location") or "75")
    return zone.startswith("75") and len(zone) in (2, 5)


def zone_of(rule):
    """The rule's time zone: the one of the browser it was set in, Paris by default."""
    try:
        return ZoneInfo(rule.get("tz") or "Europe/Paris")
    except Exception:
        return PARIS


def _aware(dt):
    if dt is None:
        return None
    if not isinstance(dt, datetime):
        dt = datetime.fromisoformat(str(dt).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _start_time(start):
    h, m = (start or DEFAULT_START).split(":")
    return dtime(int(h), int(m))


def slot_on(day, rule):
    """(start, end) of the ticket window on a Paris day, or None if no ticket is due that day."""
    paris = in_paris(rule)
    if day.weekday() not in rule["days"] or (paris and free_day(day)):
        return None
    # A rule chosen on the calendar: only between its first and last day (ISO dates, both included).
    if (rule.get("date_from") and day < date.fromisoformat(rule["date_from"])) or (
            rule.get("date_to") and day > date.fromisoformat(rule["date_to"])):
        return None
    tz = zone_of(rule)
    begin = datetime.combine(day, _start_time(rule.get("start")), tz)
    if rule.get("unit") == "Hours":
        end = begin + timedelta(hours=float(rule.get("duration") or 1))
    elif rule.get("unit") == "Minutes":
        end = begin + timedelta(minutes=float(rule.get("duration") or 60))
    elif paris:  # a day ticket: worth taking until paid parking ends that day
        end = max(datetime.combine(day, PAID_UNTIL, tz), begin + timedelta(hours=1))
    else:  # elsewhere paid hours are not known: the ticket's own length
        end = begin + timedelta(days=float(rule.get("duration") or 1))
    return begin, end


def current_slot(rule, now):
    """The window containing now, if any."""
    now = _aware(now)
    slot = slot_on(now.astimezone(zone_of(rule)).date(), rule)
    return slot if slot and slot[0] <= now < slot[1] else None


def next_slot(rule, after):
    """Start of the first window beginning strictly after `after` (None if the rule can never pay)."""
    after = _aware(after)
    day = after.astimezone(zone_of(rule)).date()
    for i in range(400):
        slot = slot_on(day + timedelta(days=i), rule)
        if slot and slot[0] > after:
            return slot[0]
    return None


def paused_at(paused_from, paused_until, now):
    start, end = _aware(paused_from), _aware(paused_until)
    return bool(start) and start <= now and (end is None or now < end)


def decide(rule, now, paused_from=None, paused_until=None, last_payment=None, covered_until=None):
    """Should a ticket be paid right now? Returns (pay, next_check).

    `covered_until` is the end of the car's current ticket (PayByPhone CURRENT sessions), None if there is
    none or it is not known yet; `last_payment` the last ticket this rule paid. Never pays twice: not while a
    ticket covers the car, not twice in the same window.
    """
    now = _aware(now)
    later = next_slot(rule, now)
    if paused_at(paused_from, paused_until, now):
        end = _aware(paused_until)
        return False, (next_slot(rule, end - timedelta(seconds=1)) if end else now + timedelta(hours=12))
    slot = current_slot(rule, now)
    if not slot:
        return False, later
    paid = _aware(last_payment)
    if paid and paid >= slot[0]:
        return False, later
    covered = _aware(covered_until)
    if covered and covered > now:
        # The ticket in place may end before the window does: look again then.
        return False, (covered + timedelta(seconds=30) if covered < slot[1] else later)
    return True, later


def next_ticket(rule, now, paused_from=None, paused_until=None):
    """When the next ticket will be taken, for display (skips a pause)."""
    now = _aware(now)
    at = next_slot(rule, now - timedelta(seconds=1))
    for _ in range(400):
        if at is None or not paused_at(paused_from, paused_until, at):
            return at
        at = next_slot(rule, at)
    return None
