-- Add reimbursable flag to receipts
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS reimbursable BOOLEAN DEFAULT true;

-- Add reimbursement mode to settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS reimbursement_mode TEXT DEFAULT 'all'
  CHECK (reimbursement_mode IN ('all', 'none', 'helpers_only'));

-- Add helpers list to settings (comma separated phone numbers or names)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS helper_identifiers TEXT DEFAULT '';

-- Add reimbursed tracking
CREATE TABLE IF NOT EXISTS reimbursements (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  year            INT NOT NULL,
  week_number     INT NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  paid_at         TIMESTAMPTZ DEFAULT NOW(),
  note            TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reimbursements DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_reimbursements_household ON reimbursements(household_id);
CREATE INDEX IF NOT EXISTS idx_reimbursements_week ON reimbursements(year, week_number);
