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

The actual data fetching lives in services/mcp_queries.py, not here — these
handlers just authenticate and call it. That's what lets the remote MCP
server (mcp_server/remote.py, mounted into this same app) call the same
logic in-process instead of looping back over HTTP to itself.
"""
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, Query
from services.supabase_client import get_supabase

import services.mcp_queries as queries
from services.mcp_auth import hash_key, SCOPE

router = APIRouter()

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
    return _supabase


def resolve_household_id(key: str) -> str:
    """Verify an MCP API key and return the household_id it's scoped to."""
    res = _db().table("api_keys")\
        .select("id, household_id, revoked_at")\
        .eq("key_hash", hash_key(key))\
        .eq("scope", SCOPE)\
        .execute()
    if not res.data or res.data[0]["revoked_at"]:
        raise HTTPException(status_code=403, detail="Invalid or revoked MCP API key")

    key_row = res.data[0]
    _db().table("api_keys").update({"last_used_at": "now()"}).eq("id", key_row["id"]).execute()
    return key_row["household_id"]


def _authenticate(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing MCP API key")
    return resolve_household_id(auth.split(" ", 1)[1])


@router.get("/mcp/data/this-week")
def mcp_this_week(request: Request):
    return queries.this_week(_authenticate(request))


@router.get("/mcp/data/last7days")
def mcp_last_7_days(request: Request):
    return queries.last_7_days(_authenticate(request))


@router.get("/mcp/data/weeks")
def mcp_list_weeks(request: Request):
    return queries.list_weeks(_authenticate(request))


@router.get("/mcp/data/weeks/{year}/{week_number}")
def mcp_get_week(year: int, week_number: int, request: Request):
    return queries.week_detail(_authenticate(request), year, week_number)


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
    return queries.search_receipts(household_id, start_date, end_date, vendor, flagged, limit)


@router.get("/mcp/data/receipts/{receipt_id}")
def mcp_get_receipt(receipt_id: str, request: Request):
    household_id = _authenticate(request)
    receipt = queries.get_receipt(household_id, receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return receipt


@router.get("/mcp/data/vendors")
def mcp_top_vendors(
    request: Request,
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    limit: int = Query(default=10, le=100),
):
    household_id = _authenticate(request)
    return queries.top_vendors(household_id, start_date, end_date, limit)


@router.get("/mcp/data/insurance")
def mcp_list_insurance(request: Request):
    return queries.list_insurance(_authenticate(request))


@router.get("/mcp/data/budgets")
def mcp_list_budgets(request: Request, month: Optional[str] = Query(default=None)):
    return queries.list_budgets(_authenticate(request), month)


@router.get("/mcp/data/price-history")
def mcp_price_history(request: Request, canonical_name: str = Query(...)):
    household_id = _authenticate(request)
    return queries.price_history(household_id, canonical_name)
