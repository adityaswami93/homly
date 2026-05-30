# Task 020 — LangGraph Implementation

## Why LangGraph

The original bot used a flat `if/elif` chain in the `messages.upsert` handler to decide whether an
incoming message was a receipt, recipe, query, etc. Each branch called a different function, making
it difficult to add new message types, share state across steps, or attach conversation memory.

LangGraph replaces that chain with a compiled, stateful directed graph. Each node is an isolated
Python function; routing is declared separately from logic; and a checkpointer can be attached to
give each WhatsApp group its own persistent conversation thread — all with zero changes to the
underlying agent functions.

---

## State Shape (`HomlyState`)

| Field | Type | Why it exists |
|-------|------|---------------|
| `household_id` | `str` | Partition key for every DB read/write. All agents scope queries with this. |
| `group_jid` | `Optional[str]` | WhatsApp group JID — needed when a node or the caller needs to route a reply. |
| `query` | `Optional[str]` | Raw text from a WhatsApp message or API call. Populated when the trigger is text. |
| `image_bytes` | `Optional[bytes]` | Raw image/PDF payload. Populated when the trigger is a media message. |
| `image_mime` | `Optional[str]` | MIME type (e.g. `image/jpeg`) — required by the vision model API. |
| `message_type` | `Optional[str]` | Set by `classify_node`. Drives the conditional edge out of classify. One of `"receipt"`, `"recipe"`, `"text_query"`, `"pantry_command"`, `"unknown"`. |
| `agent_results` | `Annotated[list, add]` | Reducer-merged list so parallel agent nodes can each append without overwriting each other. |
| `response` | `Optional[str]` | Final WhatsApp-ready string, assembled by `synthesise_node`. The bot sends this to the group. |
| `context` | `Optional[list]` | Last N conversation turns as `[{role, content}]` pairs. Passed to the LLM for follow-up awareness. |
| `error` | `Optional[str]` | Non-fatal error description. `synthesise_node` can fall back to a user-friendly message when set. |

---

## Node Responsibilities

```
__start__
    │
    ▼
┌──────────┐
│ classify │  LLM (image) or keyword match (text) → sets message_type
└────┬─────┘
     ├── "receipt"        ──► receipt_node  ──► synthesise ──► __end__
     ├── "recipe"         ──► recipe_node   ──► synthesise ──► __end__
     ├── "text_query"     ──► query_node    ──► synthesise ──► __end__
     ├── "pantry_command" ──► pantry_node   ──► synthesise ──► __end__
     └── "unknown"        ──────────────────────────────────► __end__
```

| Node | Source function | What it does |
|------|-----------------|--------------|
| `classify` | `classify_node` | Image → vision LLM classifies as receipt/food_photo/other. Text → pure keyword match (no LLM). |
| `receipt` | `receipt_agent.analyse_receipt` | Vision OCR → structured receipt JSON. |
| `recipe` | `recipe_agent.analyse_dish_with_pantry` | Vision → dish identification + pantry cross-reference. |
| `query` | `router_agent.run_query` | LLM router dispatches to GroceryQueryAgent / InsuranceQueryAgent / etc. |
| `pantry` | `router_agent.run_query` | Same router, specialised for pantry update commands. |
| `synthesise` | `synthesise_node` | Reads `agent_results`, formats a WhatsApp-friendly string into `response`. |

---

## How to Add a New Agent Node

1. Create the agent function (e.g. `agents/budget_agent.py`).
2. In `homly_graph.py`:
   - Add a node function (e.g. `budget_node`) that calls the agent and appends `{"agent": "budget", "data": result}` to `agent_results`.
   - Register it: `_builder.add_node("budget", budget_node)`.
   - Add a new classification branch in `classify_node` (or a new keyword prefix in `_PANTRY_PREFIXES` / `_QUERY_PREFIXES`).
   - Wire the conditional edge: `"budget_query": "budget"`.
   - Add `_builder.add_edge("budget", "synthesise")`.
3. Handle the new agent in `synthesise_node`'s `if agent == "budget":` branch.

No other files need changing.

---

## Checkpointer Setup

LangGraph's `PostgresSaver` stores conversation checkpoints in the same Postgres database as the
rest of the app.  It creates its own tables (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`)
via `checkpointer.setup()` on first use.

```
SUPABASE_DB_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
```

Get the value from: Supabase dashboard → Settings → Database → Connection string (direct).

If `SUPABASE_DB_URL` is not set the system falls back silently to a stateless graph — no memory,
no error.  All functionality works; only cross-message context is lost.

---

## `thread_id` Convention

Each WhatsApp group JID is used as the `thread_id` passed to the LangGraph checkpointer config:

```python
config = {"configurable": {"thread_id": group_jid}}
```

This means every group has its own independent conversation thread.  A follow-up question like
"what about last month?" will have access to the previous exchange within the same group.

The `/query` API endpoint uses `with_memory=False` (stateless) because the frontend doesn't yet
pass a stable `thread_id`.

---

## Graph Diagram

```mermaid
graph TD;
    __start__ --> classify;
    classify -. unknown .-> __end__;
    classify -. pantry_command .-> pantry;
    classify -. text_query .-> query;
    classify -.-> receipt;
    classify -.-> recipe;
    pantry --> synthesise;
    query --> synthesise;
    receipt --> synthesise;
    recipe --> synthesise;
    synthesise --> __end__;
```
