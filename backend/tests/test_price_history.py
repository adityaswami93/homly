"""
services/price_history.compute_price_insights() backs both /insights/price-history
and the MCP price-history tool (see CLAUDE.md's price_history.py entry) —
one implementation, two callers.
"""
from services.price_history import compute_price_insights


def _row(unit_price, vendor="FairPrice"):
    return {"unit_price": unit_price, "vendor": vendor}


def test_empty_history_returns_none():
    assert compute_price_insights([]) is None


def test_avg_min_max_and_buy_count():
    history = [_row(2.0), _row(3.0), _row(4.0)]
    result = compute_price_insights(history)
    assert result["avg_price"] == 3.0
    assert result["min_price"] == 2.0
    assert result["max_price"] == 4.0
    assert result["buy_count"] == 3


def test_last_price_and_vendor_come_from_last_row():
    history = [_row(2.0, "FairPrice"), _row(5.0, "Cold Storage")]
    result = compute_price_insights(history)
    assert result["last_price"] == 5.0
    assert result["last_vendor"] == "Cold Storage"


def test_best_vendor_is_lowest_average():
    history = [
        _row(5.0, "Cold Storage"),
        _row(5.0, "Cold Storage"),
        _row(3.0, "FairPrice"),
        _row(3.0, "FairPrice"),
    ]
    result = compute_price_insights(history)
    assert result["best_vendor"] == "FairPrice"
    assert result["best_price"] == 3.0


def test_trending_up_down_stable_over_last_four():
    assert compute_price_insights([_row(1.0), _row(2.0)])["trending"] == "up"
    assert compute_price_insights([_row(2.0), _row(1.0)])["trending"] == "down"
    assert compute_price_insights([_row(2.0), _row(2.0)])["trending"] == "stable"


def test_trending_is_none_with_fewer_than_two_priced_rows():
    assert compute_price_insights([_row(1.0)])["trending"] is None


def test_trending_only_looks_at_last_four_rows():
    # Overall the price rose (1.0 -> 4.0 -> 1.0), but only the most recent
    # four rows (2,3,4,1) should be considered, and those end lower than
    # they start, so trending should read "down".
    history = [_row(1.0), _row(2.0), _row(3.0), _row(4.0), _row(1.0)]
    result = compute_price_insights(history)
    assert result["trending"] == "down"


def test_rows_with_no_unit_price_are_excluded_from_price_stats():
    history = [_row(None), _row(4.0)]
    result = compute_price_insights(history)
    assert result["avg_price"] == 4.0
    assert result["min_price"] == 4.0


def test_rows_missing_vendor_are_excluded_from_best_vendor():
    history = [{"unit_price": 2.0, "vendor": None}]
    result = compute_price_insights(history)
    assert result["best_vendor"] is None
    assert result["best_price"] is None
