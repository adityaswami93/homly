"""
Shared receipt/item aggregation helpers used by multiple routers (expenses,
MCP data query) so category totals are computed identically everywhere.
"""


def compute_category_totals(items: list[dict]) -> dict[str, float]:
    """Sum item line_total grouped by category. Items with no category are
    bucketed under 'other'."""
    totals: dict[str, float] = {}
    for item in items:
        cat = item.get("category") or "other"
        totals[cat] = round(totals.get(cat, 0) + (item.get("line_total") or 0), 2)
    return totals
