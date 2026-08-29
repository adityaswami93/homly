"""
api/routers/expenses.py's `_reimbursement_groups`/`_week_for_date` are the
custom-week-boundary math CLAUDE.md calls out by name: "custom week
boundaries not aligning with ISO weeks caused a real reimbursement-total
bug." These pin down the exact behavior that bug depended on getting right.
"""
import importlib.util
import os
from datetime import date

# Loaded by file path rather than `from api.routers.expenses import ...`:
# api/, services/, and agents/ are implicit namespace packages (no
# __init__.py) while some of their subpackages (api.routers, api.dependencies,
# services.llm, ...) are regular packages, and that mix has produced
# environment-dependent import resolution for this module specifically in CI
# (a working-tree-verified `_reimbursement_groups`/`_week_for_date` still
# raised "cannot import name" from a dotted import in one CI run). Loading
# the file directly sidesteps sys.path/namespace-package resolution
# entirely, so it can't be affected by whatever caused that.
_expenses_path = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "api", "routers", "expenses.py",
)
_spec = importlib.util.spec_from_file_location("_expenses_under_test", _expenses_path)
_expenses = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_expenses)
_reimbursement_groups = _expenses._reimbursement_groups
_week_for_date = _expenses._week_for_date


def test_week_for_date_returns_iso_week_and_year():
    # Thursday, ISO week 1 of 2026 falls on 2026-01-01.
    assert _week_for_date(date(2026, 1, 1)) == (1, 2026)


def test_week_for_date_handles_iso_year_boundary():
    # 2024-12-30 is a Monday that belongs to ISO week 1 of 2025, not
    # calendar year 2024 — the whole reason `.isocalendar()` is used
    # instead of `.year`/a naive week-of-year calc.
    assert _week_for_date(date(2024, 12, 30)) == (1, 2025)


def test_reimbursement_groups_ignores_non_reimbursable_receipts():
    receipts = [
        {"reimbursable": False, "year": 2026, "week_number": 10, "total": 100.0},
    ]
    assert _reimbursement_groups(receipts) == []


def test_reimbursement_groups_sums_by_true_iso_week():
    receipts = [
        {"reimbursable": True, "year": 2026, "week_number": 10, "total": 25.5},
        {"reimbursable": True, "year": 2026, "week_number": 10, "total": 14.5},
        {"reimbursable": True, "year": 2026, "week_number": 11, "total": 9.0},
    ]
    groups = _reimbursement_groups(receipts)
    by_week = {(g["year"], g["week_number"]): g["amount"] for g in groups}
    assert by_week == {(2026, 10): 40.0, (2026, 11): 9.0}


def test_reimbursement_groups_skips_receipts_missing_week_info():
    receipts = [
        {"reimbursable": True, "year": None, "week_number": None, "total": 50.0},
    ]
    assert _reimbursement_groups(receipts) == []


def test_reimbursement_groups_treats_missing_total_as_zero():
    receipts = [
        {"reimbursable": True, "year": 2026, "week_number": 10, "total": None},
    ]
    assert _reimbursement_groups(receipts) == [{"year": 2026, "week_number": 10, "amount": 0}]
