-- 016_budgets.sql
-- Monthly household budgets (overall + per category)

CREATE TABLE IF NOT EXISTS budgets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,          -- YYYY-MM
  category     TEXT,                   -- NULL = overall household budget
  amount       NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  created_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, month, category)
);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "budgets_household_member" ON budgets
  FOR ALL USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS budgets_household_month_idx ON budgets (household_id, month);
