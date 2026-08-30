# 037 — Conversation Memory for the WhatsApp Assistant

## Problem

The assistant had **no short-term memory at all**, and it was visible in the group chat.
A household member replied to one of the bot's own messages with a 😮 and got back:

> Ha, that's a big reaction for no context, Bhavya 😄 What happened — did something in
> the group chat spook you, or are you testing me?

The bot's own message was one line above it in the same chat.

The cause was structural, not a prompt problem. The WhatsApp bot makes **one stateless
HTTP request per incoming message** (`POST /internal/graph-invoke`). The chat supervisor
(`agents/orchestrator/supervisor.py`) has always accepted a `context` argument and folds
it into the LLM message list — but the WhatsApp entry point hard-coded it:

```python
state = {
    ...
    "context": [],          # api/routers/internal.py
}
```

and **nothing anywhere wrote a conversational turn down**. There was no table, no
service, no write path. So `context` was structurally incapable of ever being non-empty
on the WhatsApp path, and every message was reasoned about in total isolation.

Three symptoms fell out of that one gap:

1. **No referent resolution.** "how much then?", "and last month?", "yes, do that",
   "it" / "that" — all unanswerable, because the thing being referred to was gone.
2. **Follow-ups needed re-addressing.** With `bot_engagement_mode` at `mentioned` or
   `smart`, the *answer to the bot's own question* is unaddressed text, so the
   engagement gate dropped it. The bot could ask something and then ignore the reply.
3. **Classification with no thread.** `_classify_text()` sorted each message on its own
   words alone, so a follow-up that carries its subject implicitly ("and last month?")
   read as `unknown` rather than as the expense query it plainly is.

### Why the existing checkpointer did not already cover this

`homly_graph.get_graph(with_memory=True)` compiles the graph with a LangGraph
`PostgresSaver` keyed per `thread_id` (the group JID), which *looks* like conversation
memory and is not:

- It persists **graph state**, not a transcript. The state has no message history —
  `HomlyState` carries one `query`, one `response`.
- `classify_node` is the entry point and deliberately **wipes** the per-message fields
  on every run (`_RUN_RESET`), because leftovers from the previous run were being read
  as the current one's — a real bug that was fixed by clearing them.
- It silently falls back to a **stateless** graph when `SUPABASE_DB_URL` is unset.

So the checkpointer was never the missing piece, and reaching for it would have produced
memory that vanished on a config gap.

## Solution

Add a real transcript, and put every rule about it in one module.

**`conversation_messages`** (migration `035`) stores every message the group sees, both
directions. **`services/conversation.py`** owns the read/write paths *and* the policy
questions — how many turns count as "the conversation" (20), how long it stays live
(6h), and whether the bot is still awaiting a reply (10 min, nothing said in between).
No caller re-derives those.

```
Inbound — api/routers/internal.py's /internal/graph-invoke:

    conversation.get_context(household_id, group_jid)   ← BEFORE recording this message,
    ↓                                                     so it appears exactly once — as
    ↓                                                     the query, not also as the last
    ↓                                                     context entry
    conversation.record_user_message(...)               role='user'
    ↓
    graph.invoke(state with context=…)
        ↓ classify_node reads it twice:
        ↓   _classify_text(query, context) — a follow-up is classified by what it
        ↓     follows up on
        ↓   _is_follow_up(state)           — the fourth `addressed` signal
        ↓ query_node / pantry_node pass it to run_query(context=…)
    ↓
    conversation.record_assistant_message(...) if the run produced a response
```

Messages the bot **initiates** (pantry confirmation prompts, weekly summaries, insurance
renewal reminders, the 08:00 proactive notifications, `POST /messages/send`) never come
back through that response, so they are recorded at the one choke point they all pass
through — `services/whatsapp_client.py`'s `send_text()` / `send_text_sync()`.

## Technical notes

### Every member message is recorded, including ones the bot won't answer

This is deliberate and is half the fix. The bot lives in a *shared* group; the messages
members send each other are the conversation it is sitting in. Recording only the
messages it replied to would leave it reading its own monologue, which is close to what
the screenshot shows.

### Recording at the transport, not at the five call sites

`send_text`/`send_text_sync` is the single queue every bot-initiated message passes
through. Recording per call site would mean five places to remember (scheduler ×3,
proactive monitor, pantry prompt, `/messages/send`) — and the one that got missed would
be a silent hole in the assistant's memory of its *own* words. `household_id` is an
optional argument there because several of those callers only know the group JID;
`resolve_household_id()` maps it via `settings.group_jid`, cached per process.

### Load-before-record ordering

`get_context()` runs before `record_user_message()`. Reversed, the current message would
come back as the last context entry *and* be passed as the query — the model would see
it twice and could read it as the group having repeated itself.

Bot messages sent mid-run (the pantry prompt) are recorded by the transport as they are
sent, so they land after the user turn that triggered them: the transcript order matches
what the group actually saw.

### The follow-up signal is narrow on purpose

`is_awaiting_reply()` requires the bot's message to be the **last** entry in the
transcript and within 10 minutes. Any human message after the bot's makes the last entry
theirs, so ordinary group chatter closes the window immediately. This matters because
the signal upgrades a message to `addressed`, which bypasses the engagement gate — a
loose version would have the bot butting into conversations between members.

### Context reaches the LLM classifier only, not the keyword fallback

`_classify_text_keywords()` matches on how a string *starts*, which says nothing useful
about what a follow-up is following. Guessing from prefixes with a thread in hand would
be worse than the honest `unknown`, which already routes to the assistant anyway.

### Speaker labels

A user turn renders as `"Aditya: how much on groceries?"`. A group has more than two
speakers, so who said it is part of the message — without it the assistant can't tell
the person it's replying to from the two others talking around them.

### Failure posture

Every path degrades to "no memory", never to a dropped message. A failed transcript read
returns `[]`; a failed write returns `False` and is logged; a duplicate
`whatsapp_message_id` (a Baileys redelivery) hits the partial unique index and is
skipped, which is the point. This is the same posture as `bot_profile.get_profile()`:
an unreachable settings row must not take the bot offline.

## Testing

`backend/tests/test_conversation_context.py` — 12 tests, no live LLM or DB:

- `is_awaiting_reply()` — bot last and recent; a member spoke after; window expired;
  empty and un-timestamped context (the `/query` caller shape).
- `get_context()` — newest-first rows returned oldest-first, speaker labelling, no DB
  call without a `group_jid`, and empty-on-failure.
- `classify_node` — a reply to the bot's own message counts as addressed even in
  `mentioned` mode; unaddressed chatter after a member spoke is still ignored.
- `_classify_text()` — the transcript reaches the prompt, is absent when there is no
  context, and the keyword fallback still works when the model call fails.

`tests/test_classify_text.py`'s signature assertion was updated for the new
`_classify_text_llm(text, context)` parameter.

## Follow-ups not taken here

- **No retention/pruning job.** Reads are bounded by a recency window and a row limit, so
  the table grows without affecting behaviour — but it does grow.
- **No per-household opt-out.** Recording is unconditional. If a household wants the
  assistant memoryless, that would be a `bot_memory_enabled` column alongside
  `bot_proactive_enabled`, gating `get_context()` and the two record calls.
- **Command replies handled entirely in the bot** (`/help`, `/remind`, custom commands)
  never reach the backend, so they are absent from the transcript.
