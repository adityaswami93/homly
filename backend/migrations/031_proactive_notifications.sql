-- Dedup log for the proactive household monitor (agents/proactive_agent.py).
--
-- The monitor runs unprompted on a schedule and decides for itself whether
-- something (a budget over its limit, a pantry item critically low, etc.) is
-- worth messaging the group about. Without a record of what it already said,
-- the same finding would resurface and get re-notified on every run until
-- the underlying condition changes -- this table is what lets a notify call
-- check "did I already say this recently?" before actually sending.

CREATE TABLE IF NOT EXISTS proactive_notification_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  finding_key       TEXT NOT NULL,
  last_notified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, finding_key)
);

-- Written only by the backend service-role client (no user-facing router
-- reads or writes this table) -- same posture as pantry_pending_confirmations.
ALTER TABLE proactive_notification_log DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_proactive_notification_log_household
  ON proactive_notification_log(household_id);
