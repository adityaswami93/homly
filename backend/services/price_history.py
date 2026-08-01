"""
Shared price_history analysis, used by /insights/price-history and the MCP
data-query endpoints so trend/best-vendor math isn't computed twice.
"""
from collections import defaultdict


def compute_price_insights(history: list[dict]) -> dict | None:
    """Given price_history rows for one canonical_name (ordered oldest→newest),
    return avg/min/max/trend/best-vendor insights, or None if there's no data."""
    if not history:
        return None

    prices      = [r["unit_price"] for r in history if r["unit_price"]]
    avg_price   = round(sum(prices) / len(prices), 2) if prices else None
    min_price   = min(prices) if prices else None
    max_price   = max(prices) if prices else None
    last_price  = history[-1]["unit_price"]
    last_vendor = history[-1]["vendor"]

    vendor_prices: dict[str, list] = defaultdict(list)
    for r in history:
        if r["vendor"] and r["unit_price"]:
            vendor_prices[r["vendor"]].append(r["unit_price"])
    best_vendor = None
    best_avg    = None
    for vendor, vprices in vendor_prices.items():
        avg = sum(vprices) / len(vprices)
        if best_avg is None or avg < best_avg:
            best_avg    = round(avg, 2)
            best_vendor = vendor

    recent   = [r["unit_price"] for r in history[-4:] if r["unit_price"]]
    trending = None
    if len(recent) >= 2:
        if recent[-1] > recent[0]:
            trending = "up"
        elif recent[-1] < recent[0]:
            trending = "down"
        else:
            trending = "stable"

    return {
        "avg_price":   avg_price,
        "min_price":   min_price,
        "max_price":   max_price,
        "last_price":  last_price,
        "last_vendor": last_vendor,
        "best_vendor": best_vendor,
        "best_price":  best_avg,
        "trending":    trending,
        "buy_count":   len(history),
    }
