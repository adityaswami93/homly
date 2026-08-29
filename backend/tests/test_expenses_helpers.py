"""
api/routers/expenses.py's `_week_for_date` is the ISO-week-boundary math
CLAUDE.md calls out by name: "custom week boundaries not aligning with ISO
weeks caused a real reimbursement-total bug."

Imported by file path (importlib) rather than `from api.routers.expenses
import ...`: that module's own top-level imports (fastapi, supabase) aren't
installed in every environment this test suite runs in, and loading by path
keeps this test independent of whether the package is otherwise importable.
"""
import importlib.util
import os
from datetime import date

_expenses_path = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "api", "routers", "expenses.py",
)
_spec = importlib.util.spec_from_file_location("_expenses_under_test", _expenses_path)
_expenses = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_expenses)
_week_for_date = _expenses._week_for_date


def test_week_for_date_returns_iso_week_and_year():
    # Thursday, ISO week 1 of 2026 falls on 2026-01-01.
    assert _week_for_date(date(2026, 1, 1)) == (1, 2026)


def test_week_for_date_handles_iso_year_boundary():
    # 2024-12-30 is a Monday that belongs to ISO week 1 of 2025, not
    # calendar year 2024 — the whole reason `.isocalendar()` is used
    # instead of `.year`/a naive week-of-year calc.
    assert _week_for_date(date(2024, 12, 30)) == (1, 2025)
