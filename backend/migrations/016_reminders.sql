-- 016_reminders.sql: reminders table for WhatsApp bot /remind command
CREATE TABLE IF NOT EXISTS reminders (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  group_jid    TEXT        NOT NULL,
  sender_jid   TEXT        NOT NULL,
  sender_name  TEXT,
  message      TEXT        NOT NULL,
  remind_at    TIMESTAMPTZ NOT NULL,
  sent         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_due
  ON reminders (remind_at)
  WHERE sent = FALSE;

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- Household members can read/create/delete their own household's reminders
CREATE POLICY "reminders: household members" ON reminders
  FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );

-- Service key bypasses RLS
