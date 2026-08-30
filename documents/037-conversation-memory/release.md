# 037 — Conversation Memory for the WhatsApp Assistant — Release

## What was built

The WhatsApp assistant now remembers the conversation it is in. Previously the bot made
one stateless request per message and `/internal/graph-invoke` hard-coded the chat
supervisor's `context` to `[]` with nothing ever writing a turn down, so every message
was reasoned about in isolation — it answered a reply to its own message with "that's a
big reaction for no context", and could not resolve a follow-up like "how much then?".

A rolling per-group transcript (`conversation_messages`) is now written in both
directions and read back on every message. Three behaviours change in the group:

1. **Follow-ups resolve.** "and last month?", "yes, do that", "it"/"that", and bare
   reactions are answered against what was actually just said.
2. **Replies to the bot no longer need re-addressing.** If the bot spoke last, recently,
   with nothing in between, the next message counts as addressed — so the answer to the
   bot's own question isn't dropped by the engagement gate in `mentioned`/`smart` mode.
3. **Follow-ups classify correctly.** The text classifier sees the thread, so a message
   that carries its subject implicitly is routed by what it's actually asking for.

## Files changed

- `backend/migrations/035_conversation_messages.sql` — new. The `conversation_messages`
  table, RLS disabled (application-scoped like the rest of the schema), a
  `(household_id, group_jid, created_at DESC)` index for the one read pattern, and a
  partial unique index on `(household_id, whatsapp_message_id)` so a Baileys redelivery
  can't double a turn.
- `backend/alembic/versions/202608300930_035_conversation_messages.py` — new. Revision
  `035_conversation_messages`, parent `034_bot_personality`.
- `backend/services/conversation.py` — new. The transcript's read/write paths and the
  single owner of what counts as the current conversation: `_CONTEXT_TURNS` (20),
  `_CONTEXT_MAX_AGE_MINUTES` (360), `_FOLLOW_UP_WINDOW_MINUTES` (10). Public surface:
  `get_context()`, `record_user_message()`, `record_assistant_message()`,
  `is_awaiting_reply()`, `render_for_prompt()`, `resolve_household_id()`.
- `backend/api/routers/internal.py` — `/internal/graph-invoke` loads the context *before*
  recording the inbound message (so it appears once, as the query) and records the reply
  after the run. `_inbound_text()` renders a photo as `[sent a photo] <caption>`.
- `backend/services/whatsapp_client.py` — `send_text()`/`send_text_sync()` take an
  optional `household_id` and record every bot-initiated message. This is the one choke
  point all of them pass through, so nothing needs to remember to log itself.
- `backend/agents/homly_graph.py` — `_classify_text()`/`_classify_text_llm()` take the
  context and put the thread in the classifier prompt; `_is_follow_up()` adds the fourth
  `addressed` signal in `classify_node`; `HomlyState.context` documented.
- `backend/agents/orchestrator/supervisor.py` — system prompt now states that the
  preceding messages are the group's recent conversation and must be read before
  answering (resolve "it"/"that"/"yes"/emoji, don't repeat an answer, never claim to
  have no context).
- `backend/services/whatsapp_scheduler.py`, `backend/agents/proactive_agent.py`,
  `backend/api/routers/messages.py` — pass the `household_id` they already know to
  `send_text*`, avoiding the JID lookup.
- `backend/whatsapp/index.js` — text payloads now carry `whatsapp_message_id`
  (`msg.key?.id`), which the dedup index needs.
- `backend/tests/test_conversation_context.py` — new, 12 tests (see implementation.md).
- `backend/tests/test_classify_text.py` — signature assertion updated for
  `_classify_text_llm(text, context)`.
- `backend/tests/check_household_scoping.py` — `conversation_messages` added to the
  household-scoped table list so the guard covers it.
- `CLAUDE.md` — new "Conversation Memory Flow" section, the `conversation_messages`
  schema table, the fourth addressing signal in the Assistant Engagement Flow, and the
  services/migrations entries.

## Database migrations

`backend/migrations/035_conversation_messages.sql`, applied via Alembic:

```bash
cd backend && alembic upgrade head
```

**Apply this before or with the deploy.** Until the table exists,
`services/conversation.py` logs a warning per message and the assistant behaves exactly
as it does today (no memory) — a deploy ahead of the migration degrades rather than
breaks, but the feature does nothing until it runs.

## Environment variables

None. (`SUPABASE_DB_URL` is already required for `alembic upgrade head`.)

## Deployment steps

1. `alembic upgrade head` against the production database.
2. Deploy the backend (Railway).
3. Deploy the WhatsApp bot (Railway) — `index.js` now sends `whatsapp_message_id` on
   text messages. Deploying the backend first is safe: the field is optional, and
   without it dedup simply doesn't apply to text.

Nothing to do on the frontend — it is untouched by this change.

## Verification after deploy

In the household group:

1. Ask the bot something it answers with a number, then send only "and last month?" —
   it should answer the same question over the earlier period rather than asking what
   you mean.
2. Reply to one of its messages *without* @-mentioning it — it should respond even with
   `bot_engagement_mode` on `mentioned`.
3. Have two members chat to each other for a few messages, then ask the bot something —
   it should not have inserted itself into the chatter in between.

## Known issues

- **No retention job.** The table grows unbounded. Reads are bounded by a recency window
  and a row limit, so behaviour and cost are unaffected, but storage isn't.
- **Recording is unconditional** — there is no per-household opt-out. A household that
  wants a memoryless assistant would need a `bot_memory_enabled` setting gating
  `get_context()` and the record calls.
- **Bot-side commands are invisible to the transcript.** `/help`, `/remind`, and custom
  commands are answered inside `whatsapp/index.js` and never reach the backend, so the
  assistant has no record of those exchanges.
- **The 08:00 proactive message opens a 10-minute follow-up window.** Any group message
  in that window counts as addressed. This is intended (someone responding to the
  morning brief), but it does mean the bot is briefly more talkative after it speaks
  unprompted.
