# Homly MCP server

Lets AI tools (Claude Code, Claude Desktop, claude.ai) query and analyse
your household's Homly data directly — expenses, receipts, budgets,
insurance, price history — without going through the WhatsApp bot or web
dashboard.

Every tool call resolves to a household via a per-household API key (see
`backend/api/routers/mcp_data.py`) — there's no household_id to pass, and no
Supabase service-role key or shared secret involved. There are two ways to
connect, sharing the same key and the same underlying data
(`backend/services/mcp_queries.py`):

- **Remote (recommended)** — paste a URL into Claude, no local install.
- **Local (stdio)** — Claude launches `server.py` as a subprocess on your machine.

## 1. Generate a key

In the Homly web app: **Settings → MCP → Generate key**. Copy it immediately
— it's shown once and can't be retrieved again (you'd need to revoke it and
generate a new one). The same page shows both setups below, pre-filled with
your backend URL and the new key.

## 2a. Connect remotely (claude.ai, Claude Desktop, or Claude Code)

No install needed. In Claude's connector settings, choose **Add custom
connector** and paste:

```
https://your-backend.up.railway.app/mcp/server/homly_mcp_...
```

That's the whole URL — the key is part of it (Claude's remote-connector UI
has no separate field for bearer tokens/headers, so the key travels in the
path instead; see `backend/mcp_server/remote.py`). Revoking the key from
Settings → MCP breaks this URL immediately.

## 2b. Or connect locally (stdio)

```bash
cd backend/mcp_server
pip install -r requirements.txt
cp .env.example .env
# Fill in FASTAPI_URL (your Homly backend) and HOMLY_MCP_KEY (from step 1)
```

Register with Claude Code:

```bash
claude mcp add homly -- python /absolute/path/to/backend/mcp_server/server.py
```

Or add to `claude_desktop_config.json`:

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
issued for, on either transport.

## Revoking access

Settings → MCP → Revoke next to the key. Revocation takes effect
immediately, on both transports; anything using that key starts getting
403s (remote) or errors (stdio) on its next call. Generate a new key to
reconnect.
