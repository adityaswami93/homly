# Homly MCP server

Lets AI tools (Claude Code, Claude Desktop) query and analyse a household's
Homly data directly — expenses, receipts, budgets, insurance, price
history — without going through the WhatsApp bot or web dashboard.

It's a thin client: every tool call hits the deployed Homly FastAPI backend
using the same service-key auth the WhatsApp bot uses (see `backend/api/routers/mcp_data.py`
and CLAUDE.md's "Internal Key Auth" section). No data logic lives here.

## Setup

```bash
cd backend/mcp_server
pip install -r requirements.txt
cp .env.example .env
# Fill in FASTAPI_URL (your running backend), SUPABASE_KEY (service role key),
# and INTERNAL_KEY (must match the backend's INTERNAL_KEY env var)
```

## Register with Claude Code

```bash
claude mcp add homly -- python /absolute/path/to/backend/mcp_server/server.py
```

## Register with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "homly": {
      "command": "python",
      "args": ["/absolute/path/to/backend/mcp_server/server.py"],
      "env": {
        "FASTAPI_URL": "https://your-railway-backend.up.railway.app",
        "SUPABASE_KEY": "your-supabase-service-role-key",
        "INTERNAL_KEY": "your-internal-key"
      }
    }
  }
}
```

## Available tools

`list_households`, `get_this_week`, `get_last_7_days`, `list_weeks`, `get_week`,
`search_receipts`, `get_receipt`, `get_top_vendors`, `get_insurance_policies`,
`get_budgets`, `get_price_history` — call `list_households` first to get the
`household_id` every other tool needs.

## Security note

This server holds your Supabase **service role key**, which bypasses RLS and
can read/write any household's data on tables where RLS is disabled (most of
them — see CLAUDE.md's multi-tenancy section). Keep the `.env` file private;
don't commit it.
