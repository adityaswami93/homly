"""
services/receipts.compute_category_totals() is shared by the dashboard's
week-detail endpoint and the MCP data-query endpoints (see CLAUDE.md's
services/receipts.py entry) — a bug here shows a wrong number on both the
web dashboard and any MCP client (e.g. Claude) reading the same household's
data.
"""
from services.receipts import compute_category_totals


def test_sums_line_totals_per_category():
    items = [
        {"category": "groceries", "line_total": 10.5},
        {"category": "groceries", "line_total": 4.25},
        {"category": "transport", "line_total": 3.0},
    ]
    assert compute_category_totals(items) == {"groceries": 14.75, "transport": 3.0}


def test_missing_category_buckets_under_other():
    items = [
        {"category": None, "line_total": 5.0},
        {"line_total": 2.0},
    ]
    assert compute_category_totals(items) == {"other": 7.0}


def test_missing_line_total_counts_as_zero():
    items = [{"category": "groceries", "line_total": None}]
    assert compute_category_totals(items) == {"groceries": 0}


def test_empty_items_returns_empty_dict():
    assert compute_category_totals([]) == {}


def test_rounds_to_two_decimal_places():
    items = [
        {"category": "groceries", "line_total": 0.1},
        {"category": "groceries", "line_total": 0.2},
    ]
    assert compute_category_totals(items) == {"groceries": 0.3}
