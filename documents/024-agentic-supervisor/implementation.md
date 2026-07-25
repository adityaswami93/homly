# 024 — Agentic Query Supervisor (LangGraph + ReAct + Pluggable LLM)

## Problem

`agents/router_agent.py` was a hand-rolled dispatcher: a single OpenRouter tool-calling
call picked one agent, that agent ran once, and the result went straight back to the
user. There was no way for the router to chain lookups across domains (e.g. "can I
afford this insurance renewal given my savings?"), no shared state/message history
across a turn, and the LLM call itself was hardcoded to a specific provider/model with
no seam for swapping models later.

## Solution

Replace the router with a **LangGraph supervisor** that runs a proper ReAct loop
(reason → act → observe, repeat) over the same domain agents, and put every LLM call
behind a **provider-agnostic adapter/factory** so the model can be swapped via env vars
without touching agent or graph code.

Two entry points are preserved exactly:

- `agents.router_agent.run_query(query, household_id, context=None)` — now a 4-line
  re-export of `agents.orchestrator.run_query`.
- `agents.homly_graph`'s `query_node` / `pantry_node`, which import `run_query` from
  `router_agent` — untouched, so the WhatsApp bot and `/query` / `/internal/graph-invoke`
  endpoints needed zero changes.

## Architecture

### Module layout

```
backend/
├── agents/
│   ├── router_agent.py          # compat shim → agents.orchestrator
│   └── orchestrator/
│       ├── __init__.py          # re-exports run_query, QueryResponse
│       ├── state.py             # SupervisorState (LangGraph state schema)
│       ├── registry.py          # AGENTS list + AGENT_BY_TOOL_NAME lookup
│       └── supervisor.py        # the ReAct graph + run_query()
└── services/
    └── llm/
        ├── factory.py            # get_chat_model(provider=None) -> BaseChatModel
        └── adapters/
            └── anthropic_adapter.py   # build() -> ChatOpenAI pointed at OpenRouter
```

### The ReAct loop

```
        ┌───────────┐
   ┌───▶│  agent    │  bind_tools + invoke — Claude decides: answer, or call tool(s)
   │    └─────┬─────┘
   │          │ tool_calls present?
   │     yes  │  no ──────────────────────────────► END (answer to user)
   │          ▼
   │    ┌───────────┐
   │    │  tools    │  dispatch each requested agent.handle() in parallel
   │    │           │  (ThreadPoolExecutor), wrap results as ToolMessages
   │    └─────┬─────┘
   └──────────┘
          iterations >= 6? ──► force_finalize (no tools bound, must answer in text) ──► END
```

- **`agent_node`** binds every registered agent's `as_tool()` schema to the chat model
  and invokes it with the running `messages` list. The model's response (an `AIMessage`,
  possibly with `tool_calls`) is appended to state.
- **`tools_node`** dispatches each requested tool call to the matching `BaseQueryAgent`
  concurrently, converts each `AgentResult` into a `ToolMessage` (keyed by
  `tool_call_id`), and accumulates `agent_results` / `agents_called` via the state's
  `add`-reducer fields.
- **`_route_after_agent`** is the conditional edge: no tool calls → `END`; tool calls but
  the iteration cap is hit → `force_finalize`; otherwise → back to `tools`.
- **`force_finalize_node`** is the escape hatch — same model, no tools bound, so it is
  structurally unable to request another round and must answer in plain text from
  whatever it already knows.
- **`_MAX_ITERATIONS = 6`** bounds the loop; `run_query` also passes
  `config={"recursion_limit": 50}` as a hard backstop.

This lets the supervisor answer multi-domain questions by chaining calls — e.g. check
`query_savings` first, then `query_insurance` for an upcoming renewal amount, then
answer — without any change to the individual agents.

### Agent registry (`agents/orchestrator/registry.py`)

```python
AGENTS: list[BaseQueryAgent] = [
    GroceryQueryAgent(),
    InsuranceQueryAgent(),
    PantryQueryAgent(),
    SavingsQueryAgent(),
]
AGENT_BY_TOOL_NAME: dict[str, BaseQueryAgent] = {a.manifest.tool_name: a for a in AGENTS}
```

Adding a new domain agent (e.g. a future `RemindersQueryAgent`) is a one-line addition
here — nothing in `supervisor.py` needs to change, since tool schemas are generated from
each agent's `AgentManifest` via `BaseQueryAgent.as_tool()`.

### Pluggable LLM adapter (`services/llm/factory.py`)

```python
def get_chat_model(provider: str | None = None) -> BaseChatModel:
    provider = provider or os.getenv("AGENT_LLM_PROVIDER", "anthropic")
    module_path = _ADAPTERS.get(provider)
    ...
    return adapter.build()
```

Only one adapter exists today (`anthropic`), but the factory is the single seam for
adding more (`openai`, `google`, etc.) — agent and graph code only ever calls
`get_chat_model()`, never a concrete client.

The `anthropic` adapter is named for the model family it serves, not the transport: it
calls Claude models **through OpenRouter** (`ChatOpenAI` pointed at
`https://openrouter.ai/api/v1`) rather than Anthropic's native Messages API, because the
rest of the deployment's LLM traffic already runs through OpenRouter. Default model is
**Claude Sonnet 5** (`anthropic/claude-sonnet-5` — OpenRouter's slug convention), with
Opus intentionally left off by default. Override either the provider or the specific
model per-deployment via `AGENT_LLM_PROVIDER` / `AGENT_MODEL` without touching code.

No sampling params (`temperature`, `top_p`, `top_k`) are set — recent Claude models
(Opus 4.7+, Sonnet 5, Fable 5) reject non-default values for these with a 400 error, so
the adapter omits them entirely rather than pinning one that only some models accept.

## Claude Code prompt

(Built incrementally across a single session — no single upfront prompt. Key directives
that shaped the design, in order:)

1. "I want an orchestration agent that calls other agents" → initial supervisor + 2
   sub-agents sketch.
2. "We will have many agents and apps in future, critique this architecture" → led to
   the registry pattern instead of hardcoding agents into the supervisor.
3. "Refactor in place" (chosen over a parallel rewrite) — zero blast radius on existing
   `/query`, `/internal/graph-invoke`, and `homly_graph.py` entry points.
4. "LLM calls should be behind an interface — adapters plugged in — easily swap models"
   → `services/llm/factory.py` + `adapters/`.
5. "Implement the ReAct pattern" → rebuilt the single-shot tool-pick-then-dispatch
   supervisor into the iterative `agent` ↔ `tools` loop described above.
6. "Keep the anthropic adapter but call Claude models through OpenRouter" → adapter
   internals swapped from `ChatAnthropic` to `ChatOpenAI` against OpenRouter's
   OpenAI-compatible endpoint; adapter's name/slot in the factory unchanged.
7. "Use Sonnet as default, not Opus, keep swappability" → `DEFAULT_MODEL` constant
   changed; `AGENT_MODEL` override untouched.

## Technical notes

- **Unverified model slug**: `anthropic/claude-sonnet-5` follows OpenRouter's known
  naming convention but was never confirmed against OpenRouter's live catalog — outbound
  access to `openrouter.ai` is blocked from the dev environment this was built in.
  Confirm it resolves correctly before relying on it in production; a wrong slug fails
  loudly (400) on first call, and `AGENT_MODEL` is the override if it's off.
- **Post-merge regression caught in review**: a `SavingsQueryAgent` added by a separate,
  concurrently-merged PR wasn't in the new `orchestrator/registry.py` after a `main`
  merge — found via manual diff inspection during PR monitoring and fixed before this
  reached production (see commit `c1ba5c8`).
- **`homly_graph.py`'s `query_node` / `pantry_node` split is now vestigial**: both call
  the same `run_query()` with identical arguments; `synthesise_node` already treats
  `agent in ("query", "pantry")` identically. The classifier's `pantry_command` vs.
  `text_query` split provided real signal before this PR, but now that the ReAct
  supervisor's own tool-calling decides which domain agent to invoke, the upstream
  split adds no remaining behavior. Left as-is in this PR — flagged for a possible
  follow-up cleanup, not touched here since it wasn't part of the request.
- See `documents/agent-architecture.html` for a diagram of the current ReAct loop vs. a
  possible future hierarchical team-of-supervisors architecture.
