"""
The actual data-fetching/aggregation behind every MCP tool — used directly
(in-process) by the remote MCP server (mcp_server/remote.py, mounted into
this backend) and, via the /mcp/data/* HTTP endpoints in
api/routers/mcp_data.py, by the standalone local stdio server
(mcp_server/server.py). Keeping this logic in one place means the two
transports can never quietly disagree on what a tool returns.
"""
import os
from datetime import date, timedelta
from typing import Optional

from supabase import create_client

from services.receipts import compute_category_totals
from services.price_history import compute_price_insights

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


PAGE_SIZE = 1000


def _fetch_all(build_query) -> list[dict]:
    """Page through a Supabase/PostgREST query in PAGE_SIZE chunks so results
    aren't silently truncated at PostgREST's default response row cap.
    `build_query` is called fresh each page with (offset) -> query builder."""
    rows: list[dict] = []
    offset = 0
    while True:
        page = build_query(offset).range(offset, offset + PAGE_SIZE - 1).execute().data
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def week_detail(household_id: str, year: int, week_number: int) -> dict:
    receipts_res = _db().table("receipts")\
        .select("*")\
        .eq("household_id", household_id)\
        .eq("year", year)\
        .eq("week_number", week_number)\
        .eq("deleted", False)\
        .order("date", desc=False)\
        .execute()

    receipt_ids = [r["id"] for r in receipts_res.data]
    items_data = []
    if receipt_ids:
        items_data = _db().table("items")\
            .select("category, line_total, receipt_id")\
            .in_("receipt_id", receipt_ids)\
            .execute().data

    total = sum(r["total"] or 0 for r in receipts_res.data)
    return {
        "year":               year,
        "week_number":        week_number,
        "total":              round(total, 2),
        "reimbursable_total": round(sum(r["total"] or 0 for r in receipts_res.data if r.get("reimbursable")), 2),
        "own_total":          round(sum(r["total"] or 0 for r in receipts_res.data if not r.get("reimbursable")), 2),
        "receipt_count":      len(receipts_res.data),
        "flagged_count":      sum(1 for r in receipts_res.data if r.get("flagged")),
        "receipts":           receipts_res.data,
        "category_totals":    compute_category_totals(items_data),
    }


def this_week(household_id: str) -> dict:
    year, week_number = date.today().isocalendar()[:2]
    return week_detail(household_id, year, week_number)


def last_7_days(household_id: str) -> dict:
    today = date.today()
    date_from = today - timedelta(days=6)

    receipts_res = _db().table("receipts")\
        .select("*")\
        .eq("household_id", household_id)\
        .eq("deleted", False)\
        .gte("date", date_from.isoformat())\
        .lte("date", today.isoformat())\
        .order("date", desc=False)\
        .execute()

    receipt_ids = [r["id"] for r in receipts_res.data]
    items_data = []
    if receipt_ids:
        items_data = _db().table("items")\
            .select("category, line_total")\
            .in_("receipt_id", receipt_ids)\
            .execute().data

    return {
        "date_from":       date_from.isoformat(),
        "date_to":         today.isoformat(),
        "total":           round(sum(r["total"] or 0 for r in receipts_res.data), 2),
        "receipt_count":   len(receipts_res.data),
        "flagged_count":   sum(1 for r in receipts_res.data if r.get("flagged")),
        "receipts":        receipts_res.data,
        "category_totals": compute_category_totals(items_data),
    }


def list_weeks(household_id: str) -> list:
    rows = _fetch_all(lambda offset: _db().table("receipts")
        .select("year, week_number, total, reimbursable, flagged")
        .eq("household_id", household_id)
        .eq("deleted", False)
        .order("year", desc=True)
        .order("week_number", desc=True))

    weeks: dict[str, dict] = {}
    for r in rows:
        key = f"{r['year']}-{r['week_number']}"
        if key not in weeks:
            weeks[key] = {
                "year":               r["year"],
                "week_number":        r["week_number"],
                "total":              0,
                "reimbursable_total": 0,
                "receipt_count":      0,
                "flagged_count":      0,
            }
        weeks[key]["total"]         += r["total"] or 0
        weeks[key]["receipt_count"] += 1
        weeks[key]["flagged_count"] += 1 if r.get("flagged") else 0
        if r.get("reimbursable"):
            weeks[key]["reimbursable_total"] += r["total"] or 0

    return [
        {**w, "total": round(w["total"], 2), "reimbursable_total": round(w["reimbursable_total"], 2)}
        for w in weeks.values()
    ]


def search_receipts(
    household_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    vendor: Optional[str] = None,
    flagged: Optional[bool] = None,
    limit: int = 100,
) -> dict:
    q = _db().table("receipts")\
        .select("*")\
        .eq("household_id", household_id)\
        .eq("deleted", False)
    if start_date:
        q = q.gte("date", start_date)
    if end_date:
        q = q.lte("date", end_date)
    if vendor:
        q = q.ilike("vendor", f"%{vendor}%")
    if flagged is not None:
        q = q.eq("flagged", flagged)

    res = q.order("date", desc=True).limit(limit).execute()

    receipt_ids = [r["id"] for r in res.data]
    items_data = []
    if receipt_ids:
        items_data = _db().table("items")\
            .select("category, line_total")\
            .in_("receipt_id", receipt_ids)\
            .execute().data

    return {
        "receipts":        res.data,
        "count":           len(res.data),
        "total":           round(sum(r["total"] or 0 for r in res.data), 2),
        "category_totals": compute_category_totals(items_data),
    }


def get_receipt(household_id: str, receipt_id: str) -> Optional[dict]:
    receipt_res = _db().table("receipts")\
        .select("*")\
        .eq("id", receipt_id)\
        .eq("household_id", household_id)\
        .execute()
    if not receipt_res.data:
        return None

    items_res = _db().table("items").select("*").eq("receipt_id", receipt_id).execute()
    return {**receipt_res.data[0], "items": items_res.data}


def top_vendors(household_id: str, start_date: Optional[str] = None, end_date: Optional[str] = None, limit: int = 10) -> list:
    def build(offset):
        q = _db().table("receipts")\
            .select("vendor, total")\
            .eq("household_id", household_id)\
            .eq("deleted", False)
        if start_date:
            q = q.gte("date", start_date)
        if end_date:
            q = q.lte("date", end_date)
        return q.order("date")

    vendors: dict[str, dict] = {}
    for r in _fetch_all(build):
        name = r.get("vendor") or "Unknown"
        v = vendors.setdefault(name, {"vendor": name, "total": 0, "receipt_count": 0})
        v["total"] += r["total"] or 0
        v["receipt_count"] += 1

    ranked = sorted(vendors.values(), key=lambda v: v["total"], reverse=True)[:limit]
    return [{**v, "total": round(v["total"], 2)} for v in ranked]


def list_insurance(household_id: str) -> list:
    res = _db().table("insurance_policies")\
        .select("*")\
        .eq("household_id", household_id)\
        .eq("is_active", True)\
        .order("coverage_type")\
        .order("renewal_date", nullsfirst=False)\
        .execute()
    return res.data


def list_budgets(household_id: str, month: Optional[str] = None) -> list:
    q = _db().table("budgets").select("*").eq("household_id", household_id)
    if month:
        q = q.eq("month", month)
    return q.execute().data


def price_history(household_id: str, canonical_name: str) -> dict:
    res = _db().table("price_history")\
        .select("*")\
        .eq("household_id", household_id)\
        .eq("canonical_name", canonical_name)\
        .order("bought_at", desc=False)\
        .execute()

    return {
        "canonical_name": canonical_name,
        "history":        res.data,
        "insights":       compute_price_insights(res.data),
    }
