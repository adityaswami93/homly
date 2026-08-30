-- Rolling transcript of each household's WhatsApp group chat.
--
-- The bot makes one stateless HTTP request per incoming message
-- (/internal/graph-invoke), so until now every message was reasoned about in
-- total isolation: agents/orchestrator/supervisor.py's run_query() takes a
-- `context` argument, but the WhatsApp entry point hard-coded it to `[]`.
-- Nothing ever wrote a turn down, so nothing could read one back. The result
-- in the group was an assistant with no short-term memory at all -- it could
-- not resolve "how much then?", could not tell what a bare "yes" or an emoji
-- was reacting to, and would answer a reply to its own message with "that's a
-- big reaction for no context".
--
-- (The LangGraph PostgresSaver checkpointer in homly_graph.get_graph() does
-- not cover this. It persists the *graph state* per thread, and classify_node
-- deliberately resets the per-message fields on every run -- see _RUN_RESET.
-- It was never a conversation transcript.)
--
-- Every message the group sees is recorded here, both directions:
--   role='user'      -- a household member's message, INCLUDING ones the
--                       engagement gate decided not to answer. Those are the
--                       conversation the assistant is sitting in; dropping
--                       them is what made replies read as context-free.
--   role='assistant' -- anything the bot said into the group, whether it came
--                       back from /internal/graph-invoke or was pushed out
--                       directly (pantry confirmation prompts, weekly
--                       summaries, insurance renewal reminders, proactive
--                       notifications) via services/whatsapp_client.py.
--
-- Read back by services/conversation.py, which hands the last N turns to the
-- chat supervisor and to the text classifier.

CREATE TABLE IF NOT EXISTS conversation_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  group_jid           TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content             TEXT NOT NULL,
  sender_name         TEXT,
  sender_phone        TEXT,
  message_type        TEXT,
  whatsapp_message_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Written and read only by the backend service-role client via
-- services/conversation.py -- same posture as pantry_pending_confirmations
-- and proactive_notification_log. Household isolation is the .eq("household_id")
-- filter in that module, as everywhere else in this schema.
ALTER TABLE conversation_messages DISABLE ROW LEVEL SECURITY;

-- The only read pattern: "the last N messages in this group, newest first".
CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread
  ON conversation_messages(household_id, group_jid, created_at DESC);

-- The WhatsApp client can retry a delivery, and Baileys can redeliver a
-- message after a reconnect; either would duplicate a turn in the transcript
-- and make the assistant think something was said twice. Partial, so the many
-- rows with no WhatsApp id (bot-sent messages, dashboard callers) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_wa_id
  ON conversation_messages(household_id, whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;
