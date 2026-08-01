"""
Homly MCP server — exposes one household's expense/insurance/budget data as
MCP tools so AI tools (Claude Desktop, Claude Code) can query and analyse it
directly, without going through the WhatsApp bot or the web dashboard.

This is a thin HTTP client: every tool calls the deployed Homly FastAPI
backend's /mcp/data/* endpoints (api/routers/mcp_data.py), authenticated
with a per-household API key generated from the portal at Settings > MCP.
That key determines which household's data every tool call resolves to —
there's no household_id parameter to pass, and no Supabase service-role key
or shared INTERNAL_KEY involved. No business logic (category totals,
reimbursement math, price trends) is reimplemented here — see CLAUDE.md's
"Backend stays DRY" rule.

Run directly for local testing:
    python server.py

Configure in Claude Code / Claude Desktop as a local stdio MCP server,
e.g. `claude mcp add homly -- python /path/to/backend/mcp_server/server.py`.
Required env vars (see .env.example): FASTAPI_URL, HOMLY_MCP_KEY (generate
the key from the portal's Settings > MCP tab).
"""
import os
from typing import Optional

import httpx
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

load_dotenv()

FASTAPI_URL = os.environ["FASTAPI_URL"].rstrip("/")
MCP_KEY = os.environ["HOMLY_MCP_KEY"]

mcp = FastMCP("homly")


def _get(path: str, params: Optional[dict] = None) -> dict | list:
    headers = {"Authorization": f"Bearer {MCP_KEY}"}
    resp = httpx.get(f"{FASTAPI_URL}{path}", params={k: v for k, v in (params or {}).items() if v is not None}, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


@mcp.tool()
def get_this_week() -> dict:
    """Get the current calendar week's receipts, category totals, and
    reimbursement split for this household."""
    return _get("/mcp/data/this-week")


@mcp.tool()
def get_last_7_days() -> dict:
    """Get the trailing 7 days of receipts and category totals for this
    household — matches the WhatsApp weekly summary window."""
    return _get("/mcp/data/last7days")


@mcp.tool()
def list_weeks() -> list:
    """List every ISO week that has receipts for this household, with total
    spend, reimbursable total, receipt count, and flagged count per week."""
    return _get("/mcp/data/weeks")


@mcp.tool()
def get_week(year: int, week_number: int) -> dict:
    """Get full detail (receipts, category totals, reimbursement split) for
    one specific ISO year/week."""
    return _get(f"/mcp/data/weeks/{year}/{week_number}")


@mcp.tool()
def search_receipts(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    vendor: Optional[str] = None,
    flagged: Optional[bool] = None,
    limit: int = 100,
) -> dict:
    """Search this household's receipts with optional filters: start_date /
    end_date (YYYY-MM-DD), vendor (partial match), flagged (low-confidence
    OCR). Returns matching receipts plus a total and category breakdown."""
    return _get("/mcp/data/receipts", {
        "start_date": start_date, "end_date": end_date,
        "vendor": vendor, "flagged": flagged, "limit": limit,
    })


@mcp.tool()
def get_receipt(receipt_id: str) -> dict:
    """Get one receipt with all of its line items."""
    return _get(f"/mcp/data/receipts/{receipt_id}")


@mcp.tool()
def get_top_vendors(start_date: Optional[str] = None, end_date: Optional[str] = None, limit: int = 10) -> list:
    """Rank vendors/stores by total spend for this household over an
    optional date range."""
    return _get("/mcp/data/vendors", {"start_date": start_date, "end_date": end_date, "limit": limit})


@mcp.tool()
def get_insurance_policies() -> list:
    """List this household's active insurance policies (provider, coverage
    type, premium, renewal date, etc.)."""
    return _get("/mcp/data/insurance")


@mcp.tool()
def get_budgets(month: Optional[str] = None) -> list:
    """Get this household's budget targets, optionally filtered to one month
    (YYYY-MM). Omit month to get all budgets on record."""
    return _get("/mcp/data/budgets", {"month": month})


@mcp.tool()
def get_price_history(canonical_name: str) -> dict:
    """Get price history and trend insights (avg/min/max price, best vendor,
    trending up/down/stable) for one grocery item across this household's
    receipts."""
    return _get("/mcp/data/price-history", {"canonical_name": canonical_name})


if __name__ == "__main__":
    mcp.run()
