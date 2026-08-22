# Phase 3 — Pantry Receipt Confirmation: Implementation Notes

## What changed

### `backend/agents/homly_graph.py`
Five new nodes added to `HomlyState` and the `StateGraph`:

| Node | Purpose |
|------|---------|
| `classify_receipt_type_node` | Determines if a saved receipt is "grocery" or "non_grocery" |
| `extract_pantry_candidates_node` | Filters receipt line items to those suitable for pantry tracking |
| `send_pantry_confirmation_node` | Sends WhatsApp message, then calls `interrupt()` to pause the graph |
| `resume_from_confirmation_node` | Parses user reply ("yes" / "no" / "1,3" / item names) |
| `update_pantry_node` | Upserts confirmed items into `pantry_items` |
| `confirm_to_user_node` | Sends final confirmation message back to the group |

New state fields: `receipt_id`, `receipt_category`, `pantry_candidates`, `pantry_confirmation_pending`, `confirmed_items`.

Graph routing after `extract_pantry_candidates`:
- Non-grocery or no candidates → `synthesise` (existing path)
- Grocery with candidates → `send_pantry_confirmation` → **interrupt** → `resume_from_confirmation` → `update_pantry` → `confirm_to_user` → `synthesise`

### `backend/services/receipt_service.py`
- Removed the auto-pantry upsert block. Pantry is now updated only after user confirmation.
- `save_receipt()` now returns `items: list` (the inserted items rows) so the graph can filter candidates without a DB round-trip.

### `backend/services/whatsapp_client.py`
- Added `send_text_sync()` — a synchronous wrapper around the outgoing message queue, safe to call from graph nodes running in a thread pool.

### `backend/migrations/025_pantry_receipt_source.sql`
- Updated `added_by` constraint to include `'receipt'` alongside `'manual'`, `'bot'`, `'recipe'`.

### `frontend/app/(shell)/expenses/pantry/page.tsx`
- `PantryItem` interface now includes `added_by`.
- Each pantry row shows 🧾 for receipt-sourced items and 🍽️ for recipe-sourced items.

## Interrupt / resume mechanics

> **Superseded — this section describes a mechanism that never worked.** See
> "Pantry Confirmation Flow" in `CLAUDE.md`. The claim below that
> `g.invoke(state, config)` transparently resumes a suspended thread is wrong:
> invoking with a fresh input dict starts a new run from the entry point, so
> `resume_from_confirmation_node` was unreachable and "yes" replies went
> nowhere. `interrupt()` additionally requires a checkpointer, which
> `get_graph()` silently drops when `SUPABASE_DB_URL` is unset — there it
> raised *after* the confirmation message had been queued, returning 500 from
> `/internal/graph-invoke`. Pending prompts now live in the
> `pantry_pending_confirmations` table and the reply is routed by
> `classify_node`. Kept below for historical context only.


LangGraph's `interrupt()` primitive serialises graph state to the PostgreSQL checkpointer and raises a special exception that causes the graph execution to stop. The graph returns to the caller in a "suspended" state.

When the bot next invokes the graph on the same `thread_id` (group JID) — regardless of what the message contains — LangGraph detects the pending interrupt and resumes execution from the point after the `interrupt()` call inside `send_pantry_confirmation_node`, then flows to `resume_from_confirmation_node`. The resumed state includes the new invocation's `query` field, which `resume_from_confirmation_node` reads to determine which items to confirm.

No changes were needed in `internal.py` or `index.js` — `g.invoke(state, config)` handles both fresh and resumed invocations transparently.

## Grocery detection heuristic

A receipt is classified as grocery if:
1. The vendor name matches a known grocery chain (FairPrice, Cold Storage, Giant, etc.), **or**
2. Line items categorised as "groceries" account for >50% of total line value.

## Pantry candidate filtering

Items are excluded from the confirmation prompt if:
- Category is `"food & beverage"` (prepared food, not pantry goods)
- `line_total < SGD 0.50` (too trivial to track)
- `canonical_name` contains "plastic bag", "carrier bag", "voucher", "gift card", or "receipt"
