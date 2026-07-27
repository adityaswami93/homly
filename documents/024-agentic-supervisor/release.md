# 024 — Agentic Query Supervisor — Release

## What was built

The `/query` routing path (used by both the WhatsApp bot's text/pantry-command handling
and the dashboard) was rebuilt from a single-shot OpenRouter tool-pick into a
LangGraph-based supervisor that runs a ReAct loop (reason → act → observe, up to 6
iterations) over the existing domain agents — grocery, insurance, pantry, and savings —
so multi-domain questions can chain lookups across agents in one turn. All LLM calls now
go through a pluggable provider adapter/factory instead of a hardcoded client, so the
model can be swapped via environment variables without touching agent or graph code.

Existing entry points (`agents.router_agent.run_query`, and everything that calls it —
`homly_graph.py`'s `query_node`/`pantry_node`, the `/query` and `/internal/graph-invoke`
endpoints, the WhatsApp bot) are unchanged; `router_agent.py` is now a compat shim that
re-exports from the new `agents.orchestrator` package.

## Files changed

- `backend/agents/router_agent.py` — reduced to a 4-line re-export from
  `agents.orchestrator` (was the full router implementation).
- `backend/agents/orchestrator/__init__.py` — new. Re-exports `run_query`,
  `QueryResponse`.
- `backend/agents/orchestrator/state.py` — new. `SupervisorState` TypedDict (messages,
  agents_called, agent_results, iterations — with `add`/`add_messages` reducers).
- `backend/agents/orchestrator/registry.py` — new. `AGENTS` list + `AGENT_BY_TOOL_NAME`
  lookup; the extensibility point for adding new domain agents.
- `backend/agents/orchestrator/supervisor.py` — new. The ReAct graph (`agent_node`,
  `tools_node`, `force_finalize_node`), routing logic, and the public `run_query()`
  entrypoint (signature unchanged from the old router).
- `backend/services/llm/factory.py` — new. `get_chat_model(provider=None)` — the single
  seam for swapping LLM providers, driven by `AGENT_LLM_PROVIDER`.
- `backend/services/llm/adapters/anthropic_adapter.py` — new. Builds a `ChatOpenAI`
  client pointed at OpenRouter's OpenAI-compatible endpoint (not Anthropic's native
  Messages API), defaulting to Claude Sonnet 5, model overridable via `AGENT_MODEL`. No
  sampling params are set — several current Claude models reject non-default
  `temperature`/`top_p`/`top_k` with a 400.
- `backend/requirements.txt` — added `langgraph`, `langgraph-checkpoint-postgres`,
  `psycopg[binary]`, `langchain-core`, `langchain-openai`.
- `documents/agent-architecture.html` — architecture diagram (current ReAct loop +
  proposed future hierarchical supervisor design), self-contained with an embedded
  Mermaid.js loader so it renders standalone outside the Artifact viewer.

## Database migrations

None.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|--------------|
| `AGENT_LLM_PROVIDER` | No | `anthropic` | Selects the adapter module in `services/llm/factory.py`. |
| `AGENT_MODEL` | No | `anthropic/claude-sonnet-5` | Model slug passed to the selected adapter. Overrides the adapter's hardcoded default. |
| `OPENROUTER_API_KEY` | Yes (for the `anthropic` adapter) | — | Used by `anthropic_adapter.py` to authenticate against OpenRouter. |

`ANTHROPIC_API_KEY` is **no longer used** by this path — the `anthropic` adapter calls
Claude through OpenRouter, not Anthropic's native API.

## Deployment steps

1. Set `OPENROUTER_API_KEY` in the backend environment (Railway) if not already present.
2. Confirm `AGENT_MODEL`'s default (`anthropic/claude-sonnet-5`) actually resolves on
   OpenRouter before relying on it — this was not verified against OpenRouter's live
   catalog during development (see Known issues). Override via `AGENT_MODEL` if it
   doesn't.
3. No other manual steps — `pip install -r requirements.txt` picks up the new
   dependencies, and no migrations are required.

## Known issues

- **Unverified OpenRouter model slug**: `anthropic/claude-sonnet-5` follows OpenRouter's
  naming convention but could not be confirmed against OpenRouter's live model catalog
  from the development environment (outbound network access to `openrouter.ai` was
  blocked there). A wrong slug fails loudly with a 400 on the first `/query` call rather
  than silently — watch logs after deploy, and set `AGENT_MODEL` to a confirmed slug if
  needed.
- **`homly_graph.py`'s `query_node`/`pantry_node` split is vestigial**: both nodes call
  the same `run_query()` and are treated identically downstream by `synthesise_node`.
  Not collapsed in this release — noted as a possible follow-up cleanup, since the
  ReAct supervisor's own tool-calling already makes the distinction unnecessary.
- **Concierge chat widget** (floating bottom-right natural-language command bar,
  discussed during design but not part of this PR) is not implemented — a possible
  future consumer of `agents.orchestrator.run_query`.
