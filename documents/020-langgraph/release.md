# Task 020 — Release Notes

## Files Changed

| File | Change |
|------|--------|
| `backend/requirements.txt` | Added `langgraph>=0.2.0`, `langgraph-checkpoint-postgres>=2.0.0`, `psycopg[binary]>=3.1.0` |
| `backend/agents/homly_graph.py` | New file — `HomlyState`, all graph nodes, `graph` + `get_graph()` factory |
| `backend/api/routers/query.py` | Replaced `run_query` direct call with `get_graph(with_memory=False).invoke(...)` |
| `backend/api/routers/internal.py` | Added `POST /internal/graph-invoke` endpoint |
| `backend/api/middleware/auth.py` | Added `/internal/graph-invoke` to `SKIP_AUTH_PATHS` |
| `backend/whatsapp/index.js` | Added `groupMap`, `refreshGroupMap`, `handleMessage`; replaced `messages.upsert` handler; commented out old functions |
| `backend/.env.example` | Added `SUPABASE_DB_URL` |
| `backend/scratch/test_graph.py` | Full test suite for graph (no pytest) |
| `documents/020-langgraph/implementation.md` | Architecture doc |
| `documents/020-langgraph/release.md` | This file |

## New Environment Variable

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_DB_URL` | No | Direct Postgres URL for LangGraph conversation memory. Falls back to stateless if not set. Get from Supabase dashboard → Settings → Database → Connection string (direct). |

## No Changes To

- Any existing agent files (`receipt_agent.py`, `recipe_agent.py`, `router_agent.py`, `grocery_agent.py`, `insurance_query_agent.py`, `pantry_agent.py`, `base_agent.py`)
- All other API routers
- All frontend files
- All database migrations (LangGraph's `checkpointer.setup()` handles its own tables)
- Cron jobs and message poller in `index.js`
- `groupMap`-independent bot logic (QR, connection handling, SIGTERM)

## API Contract

No changes to any existing endpoint response shapes.  `/query` returns the same
`{response, sources, handled}` structure.  `/internal/graph-invoke` is a new endpoint consumed
only by the bot.

## Rollback Instructions

### Backend

1. Revert `backend/api/routers/query.py` to import `run_query` directly:
   ```python
   from agents.router_agent import run_query
   result = await asyncio.to_thread(run_query, body.query, household_id, body.context)
   return {"response": result.response, "sources": result.sources, "handled": result.handled}
   ```
2. Remove `POST /internal/graph-invoke` from `internal.py`.
3. Remove `/internal/graph-invoke` from `SKIP_AUTH_PATHS` in `auth.py`.

### Bot (`index.js`)

1. Uncomment `isHouseholdQuery`, `handleHouseholdQuery`, `forwardText`, `processRecipeImage`,
   `processReceiptImage`, `processReceiptDocument`.
2. Replace the `messages.upsert` handler body with the original `if/elif` chain.
3. Remove `handleMessage`, `groupMap`, and `refreshGroupMap`.

### Dependencies

Remove `langgraph`, `langgraph-checkpoint-postgres`, and `psycopg` from `requirements.txt`.
