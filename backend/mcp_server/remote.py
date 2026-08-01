"""
Remote (Streamable HTTP) MCP server — the internet-reachable counterpart to
the local stdio server (mcp_server/server.py). Mounted directly into the
main FastAPI app (see api/main.py) so it deploys with everything else on
Railway; tool calls run in-process against services/mcp_queries.py instead
of looping back over HTTP to /mcp/data/*.

Auth: unlike the stdio server (Authorization header) or /mcp/data/* (same),
Claude's "Add custom connector" dialog only accepts a URL — there's no field
for a bearer token or custom header. So the MCP API key travels as a path
segment instead: the connector URL a household enters is literally
https://<backend>/mcp/server/<key>. api/main.py mounts this app at that
path, and every tool call here re-resolves the key from the current
request's path params to a household_id via the same lookup /mcp/data/*
uses (api/routers/mcp_data.resolve_household_id), so a revoked key stops
working on the very next request — nothing is cached per-connection.
"""
from mcp.server.fastmcp import Context, FastMCP

import services.mcp_queries as queries
from api.routers.mcp_data import resolve_household_id

# streamable_http_path="/" so the public URL is exactly the mount path
# (/mcp/server/{key}) with no extra /mcp suffix. stateless_http=True avoids
# pinning a session to a single server process/worker.
remote_mcp = FastMCP("homly", streamable_http_path="/", stateless_http=True)


def _household_id(ctx: Context) -> str:
    request = ctx.request_context.request
    key = request.path_params.get("key") if request is not None else None
    if not key:
        raise ValueError("Missing MCP API key in connector URL")
    return resolve_household_id(key)


@remote_mcp.tool()
def get_this_week(ctx: Context) -> dict:
    """Get the current calendar week's receipts, category totals, and
    reimbursement split for this household."""
    return queries.this_week(_household_id(ctx))


@remote_mcp.tool()
def get_last_7_days(ctx: Context) -> dict:
    """Get the trailing 7 days of receipts and category totals for this
    household — matches the WhatsApp weekly summary window."""
    return queries.last_7_days(_household_id(ctx))


@remote_mcp.tool()
def list_weeks(ctx: Context) -> list:
    """List every ISO week that has receipts for this household, with total
    spend, reimbursable total, receipt count, and flagged count per week."""
    return queries.list_weeks(_household_id(ctx))


@remote_mcp.tool()
def get_week(year: int, week_number: int, ctx: Context) -> dict:
    """Get full detail (receipts, category totals, reimbursement split) for
    one specific ISO year/week."""
    return queries.week_detail(_household_id(ctx), year, week_number)


@remote_mcp.tool()
def search_receipts(
    ctx: Context,
    start_date: str | None = None,
    end_date: str | None = None,
    vendor: str | None = None,
    flagged: bool | None = None,
    limit: int = 100,
) -> dict:
    """Search this household's receipts with optional filters: start_date /
    end_date (YYYY-MM-DD), vendor (partial match), flagged (low-confidence
    OCR). Returns matching receipts plus a total and category breakdown."""
    return queries.search_receipts(_household_id(ctx), start_date, end_date, vendor, flagged, limit)


@remote_mcp.tool()
def get_receipt(receipt_id: str, ctx: Context) -> dict:
    """Get one receipt with all of its line items."""
    receipt = queries.get_receipt(_household_id(ctx), receipt_id)
    if receipt is None:
        raise ValueError("Receipt not found")
    return receipt


@remote_mcp.tool()
def get_top_vendors(ctx: Context, start_date: str | None = None, end_date: str | None = None, limit: int = 10) -> list:
    """Rank vendors/stores by total spend for this household over an
    optional date range."""
    return queries.top_vendors(_household_id(ctx), start_date, end_date, limit)


@remote_mcp.tool()
def get_insurance_policies(ctx: Context) -> list:
    """List this household's active insurance policies (provider, coverage
    type, premium, renewal date, etc.)."""
    return queries.list_insurance(_household_id(ctx))


@remote_mcp.tool()
def get_budgets(ctx: Context, month: str | None = None) -> list:
    """Get this household's budget targets, optionally filtered to one month
    (YYYY-MM). Omit month to get all budgets on record."""
    return queries.list_budgets(_household_id(ctx), month)


@remote_mcp.tool()
def get_price_history(canonical_name: str, ctx: Context) -> dict:
    """Get price history and trend insights (avg/min/max price, best vendor,
    trending up/down/stable) for one grocery item across this household's
    receipts."""
    return queries.price_history(_household_id(ctx), canonical_name)
