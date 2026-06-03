-- 017_custom_commands.sql: custom bot commands per household
CREATE TABLE IF NOT EXISTS custom_commands (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  trigger      TEXT        NOT NULL,           -- e.g. "budget", "chores", "wifi"
  response     TEXT        NOT NULL,           -- message the bot sends back
  description  TEXT,                           -- optional note shown in the UI
  enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by   UUID        REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, trigger)
);

CREATE INDEX IF NOT EXISTS idx_custom_commands_household
  ON custom_commands (household_id)
  WHERE enabled = TRUE;

ALTER TABLE custom_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_commands: household members" ON custom_commands
  FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );
