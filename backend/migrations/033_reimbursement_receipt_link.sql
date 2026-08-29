-- Single source of truth for "has this receipt been reimbursed": a direct
-- link from the receipt to the reimbursements row that paid it, instead of
-- matching payment records to receipts by (year, week_number). That match
-- broke whenever a household's custom week (settings.summary_day) split
-- receipts from the same custom week across two different ISO weeks -- a
-- payment recorded against one ISO week would get subtracted from receipts
-- in an unrelated custom-week view that merely shared that ISO week.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS reimbursement_id UUID
  REFERENCES reimbursements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_reimbursement_id ON receipts(reimbursement_id);

-- A single payment can now cover receipts spanning an arbitrary custom-week
-- date range that crosses ISO week boundaries, so it's no longer described
-- by a single (year, week_number) pair.
ALTER TABLE reimbursements ALTER COLUMN year DROP NOT NULL;
ALTER TABLE reimbursements ALTER COLUMN week_number DROP NOT NULL;
ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS end_date DATE;
