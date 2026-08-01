"""
Read-only data-query endpoints for the Homly MCP server (backend/mcp_server/).

Unlike the other /internal/* endpoints (bot-only, gated by the shared
INTERNAL_KEY), these are gated by a per-household API key generated from the
portal (Settings > MCP, see api/routers/mcp_keys.py) and passed as a bearer
token: `Authorization: Bearer homly_mcp_...`. The key itself determines
household_id — there's no household_id request param to trust or mistrust,
which is what makes these safe to expose without INTERNAL_KEY or the
Supabase service-role key ever leaving the backend.

Keys live in the generic `api_keys` table (migrations/029_api_keys.sql) and
are looked up with `scope="mcp"` (services.mcp_auth.SCOPE) so a future
integration reusing that table can't be mistaken for an MCP key here.
"""
import os
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, Query
from supabase import create_client

from services.mcp_auth import hash_key, SCOPE
from services.receipts import compute_category_totals
from services.price_history import compute_price_insights

router = APIRouter()

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


PAGE_SIZE = 1000


def _authenticate(request: Request) -> str:
    """Verify the bearer MCP key and return the household_id it's scoped to."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing MCP API key")
    token = auth.split(" ", 1)[1]

    res = _db().table("api_keys")\
        .select("id, household_id, revoked_at")\
        .eq("key_hash", hash_key(token))\
        .eq("scope", SCOPE)\
        .execute()
    if not res.data or res.data[0]["revoked_at"]:
        raise HTTPException(status_code=403, detail="Invalid or revoked MCP API key")

    key_row = res.data[0]
    _db().table("api_keys").update({"last_used_at": "now()"}).eq("id", key_row["id"]).execute()
    return key_row["household_id"]


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


@router.get("/mcp/data/this-week")
def mcp_this_week(request: Request):
    household_id = _authenticate(request)
    year, week_number = date.today().isocalendar()[:2]
    return _week_detail(household_id, year, week_number)


@router.get("/mcp/data/last7days")
def mcp_last_7_days(request: Request):
    household_id = _authenticate(request)
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
        "date_from":         date_from.isoformat(),
        "date_to":           today.isoformat(),
        "total":             round(sum(r["total"] or 0 for r in receipts_res.data), 2),
        "receipt_count":     len(receipts_res.data),
        "flagged_count":     sum(1 for r in receipts_res.data if r.get("flagged")),
        "receipts":          receipts_res.data,
        "category_totals":   compute_category_totals(items_data),
    }


@router.get("/mcp/data/weeks")
def mcp_list_weeks(request: Request):
    household_id = _authenticate(request)
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


def _week_detail(household_id: str, year: int, week_number: int) -> dict:
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


@router.get("/mcp/data/weeks/{year}/{week_number}")
def mcp_get_week(year: int, week_number: int, request: Request):
    household_id = _authenticate(request)
    return _week_detail(household_id, year, week_number)


@router.get("/mcp/data/receipts")
def mcp_search_receipts(
    request: Request,
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    vendor: Optional[str] = Query(default=None),
    flagged: Optional[bool] = Query(default=None),
    limit: int = Query(default=100, le=500),
):
    household_id = _authenticate(request)
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


@router.get("/mcp/data/receipts/{receipt_id}")
def mcp_get_receipt(receipt_id: str, request: Request):
    household_id = _authenticate(request)
    receipt_res = _db().table("receipts")\
        .select("*")\
        .eq("id", receipt_id)\
        .eq("household_id", household_id)\
        .execute()
    if not receipt_res.data:
        raise HTTPException(status_code=404, detail="Receipt not found")

    items_res = _db().table("items").select("*").eq("receipt_id", receipt_id).execute()
    return {**receipt_res.data[0], "items": items_res.data}


@router.get("/mcp/data/vendors")
def mcp_top_vendors(
    request: Request,
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    limit: int = Query(default=10, le=100),
):
    household_id = _authenticate(request)

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


@router.get("/mcp/data/insurance")
def mcp_list_insurance(request: Request):
    household_id = _authenticate(request)
    res = _db().table("insurance_policies")\
        .select("*")\
        .eq("household_id", household_id)\
        .eq("is_active", True)\
        .order("coverage_type")\
        .order("renewal_date", nullsfirst=False)\
        .execute()
    return res.data


@router.get("/mcp/data/budgets")
def mcp_list_budgets(request: Request, month: Optional[str] = Query(default=None)):
    household_id = _authenticate(request)
    q = _db().table("budgets").select("*").eq("household_id", household_id)
    if month:
        q = q.eq("month", month)
    return q.execute().data


@router.get("/mcp/data/price-history")
def mcp_price_history(request: Request, canonical_name: str = Query(...)):
    household_id = _authenticate(request)
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
