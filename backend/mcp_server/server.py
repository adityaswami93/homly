"""
Homly MCP server — exposes household expense/insurance/budget data as MCP
tools so AI tools (Claude Desktop, Claude Code) can query and analyse it
directly, without going through the WhatsApp bot or the web dashboard.

This is a thin HTTP client: every tool calls the already-deployed Homly
FastAPI backend (either the /internal/mcp/* read-only endpoints added for
this purpose, or the existing service-key-authenticated endpoints like
/summary/last7days, /this-week, /insurance) using the same
service-key + X-Internal-Key auth the WhatsApp bot uses. No business logic
(category totals, reimbursement math, price trends) is reimplemented here —
see CLAUDE.md's "Backend stays DRY" rule.

Run directly for local testing:
    python server.py

Configure in Claude Code / Claude Desktop as a local stdio MCP server,
e.g. `claude mcp add homly -- python /path/to/backend/mcp_server/server.py`.
Required env vars (see .env.example): FASTAPI_URL, SUPABASE_KEY, INTERNAL_KEY.
"""
import os
from typing import Optional

import httpx
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

load_dotenv()

FASTAPI_URL = os.environ["FASTAPI_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_KEY"]
INTERNAL_KEY = os.environ.get("INTERNAL_KEY", "homly-internal")

mcp = FastMCP("homly")


def _get(path: str, params: Optional[dict] = None) -> dict | list:
    headers = {
        "Authorization": f"Bearer {SERVICE_KEY}",
        "X-Internal-Key": INTERNAL_KEY,
    }
    resp = httpx.get(f"{FASTAPI_URL}{path}", params={k: v for k, v in (params or {}).items() if v is not None}, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


@mcp.tool()
def list_households() -> list:
    """List every household on the platform (id, name, plan, active). Use
    this first to find the household_id needed by every other tool, unless
    the user has already told you which household they mean."""
    return _get("/internal/mcp/households")


@mcp.tool()
def get_this_week(household_id: str) -> dict:
    """Get the current calendar week's receipts, category totals, and
    reimbursement split for a household."""
    return _get("/this-week", {"household_id": household_id})


@mcp.tool()
def get_last_7_days(household_id: str) -> dict:
    """Get the trailing 7 days of receipts and category totals for a
    household — matches the WhatsApp weekly summary window."""
    return _get("/summary/last7days", {"household_id": household_id})


@mcp.tool()
def list_weeks(household_id: str) -> list:
    """List every ISO week that has receipts for a household, with total
    spend, reimbursable total, receipt count, and flagged count per week."""
    return _get("/internal/mcp/weeks", {"household_id": household_id})


@mcp.tool()
def get_week(household_id: str, year: int, week_number: int) -> dict:
    """Get full detail (receipts, category totals, reimbursement split) for
    one specific ISO year/week."""
    return _get(f"/internal/mcp/weeks/{year}/{week_number}", {"household_id": household_id})


@mcp.tool()
def search_receipts(
    household_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    vendor: Optional[str] = None,
    flagged: Optional[bool] = None,
    limit: int = 100,
) -> dict:
    """Search receipts for a household with optional filters: start_date /
    end_date (YYYY-MM-DD), vendor (partial match), flagged (low-confidence
    OCR). Returns matching receipts plus a total and category breakdown."""
    return _get("/internal/mcp/receipts", {
        "household_id": household_id, "start_date": start_date, "end_date": end_date,
        "vendor": vendor, "flagged": flagged, "limit": limit,
    })


@mcp.tool()
def get_receipt(household_id: str, receipt_id: str) -> dict:
    """Get one receipt with all of its line items."""
    return _get(f"/internal/mcp/receipts/{receipt_id}", {"household_id": household_id})


@mcp.tool()
def get_top_vendors(household_id: str, start_date: Optional[str] = None, end_date: Optional[str] = None, limit: int = 10) -> list:
    """Rank vendors/stores by total spend for a household over an optional
    date range."""
    return _get("/internal/mcp/vendors", {
        "household_id": household_id, "start_date": start_date, "end_date": end_date, "limit": limit,
    })


@mcp.tool()
def get_insurance_policies(household_id: str) -> list:
    """List active insurance policies for a household (provider, coverage
    type, premium, renewal date, etc.)."""
    return _get("/insurance", {"household_id": household_id})


@mcp.tool()
def get_budgets(household_id: str, month: Optional[str] = None) -> list:
    """Get budget targets for a household, optionally filtered to one month
    (YYYY-MM). Omit month to get all budgets on record."""
    return _get("/internal/mcp/budgets", {"household_id": household_id, "month": month})


@mcp.tool()
def get_price_history(household_id: str, canonical_name: str) -> dict:
    """Get price history and trend insights (avg/min/max price, best vendor,
    trending up/down/stable) for one grocery item across all receipts."""
    return _get(f"/internal/mcp/price-history/{canonical_name}", {"household_id": household_id})


if __name__ == "__main__":
    mcp.run()
