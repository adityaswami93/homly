-- Standing preferences the household (or an individual member) has told the
-- bot to remember, so agents/orchestrator and agents/proactive_agent don't
-- start every conversation from zero. sender_phone NULL = applies to the
-- whole household (e.g. "always remind us 2 weeks before renewals"); a
-- non-null sender_phone scopes it to that person (e.g. "I don't eat pork").

CREATE TABLE IF NOT EXISTS household_preferences (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  sender_phone   TEXT,
  key            TEXT NOT NULL,
  value          TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Written only by the backend service-role client via services/preferences.py,
-- which does its own check-then-write instead of relying on a DB-level
-- ON CONFLICT target (a plain UNIQUE(household_id, sender_phone, key) treats
-- every NULL sender_phone as distinct, so it wouldn't actually dedupe
-- household-wide preferences -- see services/preferences.py).
ALTER TABLE household_preferences DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_household_preferences_household
  ON household_preferences(household_id);
