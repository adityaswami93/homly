-- Pending pantry confirmations (replaces LangGraph interrupt()/resume).
--
-- The Phase 3 grocery-receipt flow paused the graph with interrupt() and
-- assumed the next g.invoke(state, config) on the same thread_id would resume
-- it. It does not: invoking with a fresh input dict starts a new run from the
-- entry point, so resume_from_confirmation_node was unreachable and the user's
-- "yes" reply went nowhere. Worse, interrupt() requires a checkpointer, and
-- get_graph() silently falls back to a stateless graph when SUPABASE_DB_URL is
-- unset -- there interrupt() raises and /internal/graph-invoke returns 500
-- *after* the confirmation message was already queued, so the group saw the
-- item list and nothing else.
--
-- Pending state now lives here instead, which works with or without a
-- checkpointer and matches the bot's one-HTTP-request-per-message model.

CREATE TABLE IF NOT EXISTS pantry_pending_confirmations (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id   UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  group_jid      TEXT NOT NULL,
  receipt_id     UUID REFERENCES receipts(id) ON DELETE CASCADE,
  source         TEXT NOT NULL DEFAULT 'receipt'
                   CHECK (source IN ('receipt', 'fridge_scan')),
  candidates     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  UNIQUE (group_jid)
);

ALTER TABLE pantry_pending_confirmations DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pantry_pending_household
  ON pantry_pending_confirmations(household_id);
CREATE INDEX IF NOT EXISTS idx_pantry_pending_expires
  ON pantry_pending_confirmations(expires_at);
