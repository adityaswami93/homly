# Homly MCP server

Lets AI tools (Claude Code, Claude Desktop) query and analyse your
household's Homly data directly — expenses, receipts, budgets, insurance,
price history — without going through the WhatsApp bot or web dashboard.

It's a thin client: every tool call hits the deployed Homly FastAPI backend
using a per-household API key (see `backend/api/routers/mcp_data.py`). The
key determines which household's data you're querying — there's no
household_id to pass, and no Supabase service-role key or shared secret
involved.

## 1. Generate a key

In the Homly web app: **Settings → MCP → Generate key**. Copy the key
immediately — it's shown once and can't be retrieved again (you'd need to
revoke it and generate a new one). The same page shows this exact setup,
pre-filled with your backend URL.

## 2. Install

```bash
cd backend/mcp_server
pip install -r requirements.txt
cp .env.example .env
# Fill in FASTAPI_URL (your Homly backend) and HOMLY_MCP_KEY (from step 1)
```

## 3. Register with Claude Code

```bash
claude mcp add homly -- python /absolute/path/to/backend/mcp_server/server.py
```

## Register with Claude Desktop instead

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "homly": {
      "command": "python",
      "args": ["/absolute/path/to/backend/mcp_server/server.py"],
      "env": {
        "FASTAPI_URL": "https://your-railway-backend.up.railway.app",
        "HOMLY_MCP_KEY": "homly_mcp_..."
      }
    }
  }
}
```

## Available tools

`get_this_week`, `get_last_7_days`, `list_weeks`, `get_week`, `search_receipts`,
`get_receipt`, `get_top_vendors`, `get_insurance_policies`, `get_budgets`,
`get_price_history` — every tool operates on the one household your key was
issued for.

## Revoking access

Settings → MCP → Revoke next to the key. Revocation takes effect
immediately; the MCP server (and anything using that key) starts getting
403s on its next call. Generate a new key to reconnect.
