"""
Read-only data-query endpoints for the Homly MCP server (backend/mcp_server/).

These sit alongside the other /internal/* endpoints: no JWT, gated by the
X-Internal-Key header instead (see api/routers/internal.py's `_check`
pattern). Every endpoint (other than /internal/mcp/households, which lists
all households) requires an explicit household_id query param, the same
"service key reads household_id from the request" rule the rest of the
service-key-authenticated endpoints follow — see CLAUDE.md's Auth middleware
pattern section.
"""
import os
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, Query
from supabase import create_client

from services.receipts import compute_category_totals
from services.price_history import compute_price_insights

router = APIRouter()

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


INTERNAL_KEY = os.getenv("INTERNAL_KEY", "homly-internal")


def _check(request: Request):
    if request.headers.get("X-Internal-Key") != INTERNAL_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.get("/internal/mcp/households")
def mcp_list_households(request: Request):
    _check(request)
    res = _db().table("households").select("id, name, plan, active").order("name").execute()
    return res.data


@router.get("/internal/mcp/weeks")
def mcp_list_weeks(request: Request, household_id: str = Query(...)):
    _check(request)
    res = _db().table("receipts")\
        .select("year, week_number, total, reimbursable, flagged")\
        .eq("household_id", household_id)\
        .eq("deleted", False)\
        .order("year", desc=True)\
        .order("week_number", desc=True)\
        .execute()

    weeks: dict[str, dict] = {}
    for r in res.data:
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


@router.get("/internal/mcp/weeks/{year}/{week_number}")
def mcp_get_week(year: int, week_number: int, request: Request, household_id: str = Query(...)):
    _check(request)
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


@router.get("/internal/mcp/receipts")
def mcp_search_receipts(
    request: Request,
    household_id: str = Query(...),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    vendor: Optional[str] = Query(default=None),
    flagged: Optional[bool] = Query(default=None),
    limit: int = Query(default=100, le=500),
):
    _check(request)
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


@router.get("/internal/mcp/receipts/{receipt_id}")
def mcp_get_receipt(receipt_id: str, request: Request, household_id: str = Query(...)):
    _check(request)
    receipt_res = _db().table("receipts")\
        .select("*")\
        .eq("id", receipt_id)\
        .eq("household_id", household_id)\
        .execute()
    if not receipt_res.data:
        raise HTTPException(status_code=404, detail="Receipt not found")

    items_res = _db().table("items").select("*").eq("receipt_id", receipt_id).execute()
    return {**receipt_res.data[0], "items": items_res.data}


@router.get("/internal/mcp/vendors")
def mcp_top_vendors(
    request: Request,
    household_id: str = Query(...),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    limit: int = Query(default=10, le=100),
):
    _check(request)
    q = _db().table("receipts")\
        .select("vendor, total")\
        .eq("household_id", household_id)\
        .eq("deleted", False)
    if start_date:
        q = q.gte("date", start_date)
    if end_date:
        q = q.lte("date", end_date)
    res = q.execute()

    vendors: dict[str, dict] = {}
    for r in res.data:
        name = r.get("vendor") or "Unknown"
        v = vendors.setdefault(name, {"vendor": name, "total": 0, "receipt_count": 0})
        v["total"] += r["total"] or 0
        v["receipt_count"] += 1

    ranked = sorted(vendors.values(), key=lambda v: v["total"], reverse=True)[:limit]
    return [{**v, "total": round(v["total"], 2)} for v in ranked]


@router.get("/internal/mcp/budgets")
def mcp_list_budgets(request: Request, household_id: str = Query(...), month: Optional[str] = Query(default=None)):
    _check(request)
    q = _db().table("budgets").select("*").eq("household_id", household_id)
    if month:
        q = q.eq("month", month)
    res = q.execute()
    return res.data


@router.get("/internal/mcp/price-history/{canonical_name}")
def mcp_price_history(canonical_name: str, request: Request, household_id: str = Query(...)):
    _check(request)
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
