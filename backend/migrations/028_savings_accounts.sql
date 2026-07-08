-- 028_savings_accounts.sql: savings & investments net worth tracking (country-agnostic account types)
CREATE TABLE IF NOT EXISTS savings_accounts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_type     TEXT        NOT NULL CHECK (account_type IN
                     ('bank_savings','fixed_deposit','retirement_fund','stocks','mutual_fund','bonds','property','other')),
  scheme_name      TEXT,        -- e.g. "CPF", "SRS", "EPF", "PPF", "NPS" — free text, not enum
  institution      TEXT,
  account_name     TEXT        NOT NULL,
  current_balance  NUMERIC     NOT NULL DEFAULT 0,
  currency         TEXT        NOT NULL DEFAULT 'SGD',
  interest_rate    NUMERIC,
  maturity_date    DATE,        -- for fixed deposits
  notes            TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by       UUID        REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS savings_balance_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_id    UUID        NOT NULL REFERENCES savings_accounts(id) ON DELETE CASCADE,
  balance       NUMERIC     NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_savings_accounts_household ON savings_accounts (household_id, is_active);
CREATE INDEX IF NOT EXISTS idx_savings_balance_history_household ON savings_balance_history (household_id, recorded_at);

ALTER TABLE savings_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_balance_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "savings_accounts: household members can view" ON savings_accounts
  FOR SELECT
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "savings_accounts: household admins can manage" ON savings_accounts
  FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "savings_balance_history: household members can view" ON savings_balance_history
  FOR SELECT
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "savings_balance_history: household admins can manage" ON savings_balance_history
  FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Service key bypasses RLS
