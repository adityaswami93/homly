"""services/chores.py's chore_due_today() decides what every household is told
to do each morning.

It had no test at all, despite being the shared recurrence rule behind three
independent callers — the dashboard's GET /tasks (`due_today`), the chat agent
in agents/query/tasks_agent.py, and the 07:00 SGT cron in
services/whatsapp_scheduler.py. A wrong answer here is not a wrong number on a
page; it is the assistant messaging a family about a chore that isn't due, or
silently dropping one that is.

The convention worth pinning: days_of_week is 0=Mon..6=Sun, matching
settings.summary_day and Python's date.weekday() — *not* JS's 0=Sun. The
frontend converts; the backend does not.
"""
from datetime import date

from services.chores import chore_due_today

# 2026-09-14 is a Monday, so weekday() == 0. Every date below is stated with
# its weekday so the expectations can be read without a calendar.
MON = date(2026, 9, 14)
WED = date(2026, 9, 16)
SUN = date(2026, 9, 20)


# ── daily ───────────────────────────────────────────────────────────────────


def test_daily_is_due_every_day():
    chore = {"recurrence": "daily"}
    assert all(chore_due_today(chore, d) for d in (MON, WED, SUN))


# ── weekly ──────────────────────────────────────────────────────────────────


def test_weekly_is_due_only_on_its_listed_days():
    chore = {"recurrence": "weekly", "days_of_week": [0, 2]}  # Mon + Wed
    assert chore_due_today(chore, MON) is True
    assert chore_due_today(chore, WED) is True
    assert chore_due_today(chore, SUN) is False


def test_weekly_day_numbering_is_monday_zero_not_sunday_zero():
    # If this ever flips to JS's Sun=0 convention, a "Sunday" chore starts
    # firing on Mondays. days_of_week=[6] must mean Sunday.
    sunday_only = {"recurrence": "weekly", "days_of_week": [6]}
    assert chore_due_today(sunday_only, SUN) is True
    assert chore_due_today(sunday_only, MON) is False


def test_weekly_with_no_days_listed_is_never_due():
    # Rather than defaulting to "every day", which would spam the group.
    assert chore_due_today({"recurrence": "weekly"}, MON) is False
    assert chore_due_today({"recurrence": "weekly", "days_of_week": None}, MON) is False
    assert chore_due_today({"recurrence": "weekly", "days_of_week": []}, MON) is False


# ── once ────────────────────────────────────────────────────────────────────


def test_once_is_due_only_on_its_exact_date():
    chore = {"recurrence": "once", "due_date": "2026-09-16"}
    assert chore_due_today(chore, WED) is True
    assert chore_due_today(chore, MON) is False


def test_once_compares_iso_strings_so_a_missing_due_date_is_not_due():
    # due_date arrives from Supabase as a string; a NULL must not match.
    assert chore_due_today({"recurrence": "once"}, MON) is False
    assert chore_due_today({"recurrence": "once", "due_date": None}, MON) is False


# ── anything else ───────────────────────────────────────────────────────────


def test_unknown_or_missing_recurrence_is_never_due():
    # Fail closed: an unrecognised recurrence must not be treated as daily.
    assert chore_due_today({}, MON) is False
    assert chore_due_today({"recurrence": None}, MON) is False
    assert chore_due_today({"recurrence": "fortnightly"}, MON) is False
