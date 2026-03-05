-- Add canonical fields to items table
ALTER TABLE items ADD COLUMN IF NOT EXISTS canonical_name TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS brand          TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS variant        TEXT;

-- Price history table
CREATE TABLE IF NOT EXISTS price_history (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id     UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  receipt_id       UUID NOT NULL REFERENCES receipts(id)   ON DELETE CASCADE,
  item_id          UUID REFERENCES items(id)               ON DELETE SET NULL,
  canonical_name   TEXT NOT NULL,
  brand            TEXT,
  variant          TEXT,
  category         TEXT,
  vendor           TEXT,
  unit_price       NUMERIC(10,2),
  quantity         NUMERIC(10,3) DEFAULT 1,
  bought_at        DATE NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE price_history DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_price_history_household    ON price_history(household_id);
CREATE INDEX IF NOT EXISTS idx_price_history_canonical    ON price_history(canonical_name);
CREATE INDEX IF NOT EXISTS idx_price_history_bought_at    ON price_history(bought_at);

-- Shopping list table
CREATE TABLE IF NOT EXISTS shopping_list (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id     UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  canonical_name   TEXT NOT NULL,
  brand            TEXT,
  variant          TEXT,
  category         TEXT,
  added_by         TEXT DEFAULT 'auto' CHECK (added_by IN ('auto', 'manual')),
  checked          BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(household_id, canonical_name)
);

ALTER TABLE shopping_list DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_shopping_list_household ON shopping_list(household_id);
