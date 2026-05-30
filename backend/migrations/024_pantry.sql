CREATE TABLE IF NOT EXISTS pantry_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL,
  quantity NUMERIC,
  unit TEXT,
  category TEXT,
  status TEXT DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'low', 'out_of_stock')),
  notes TEXT,
  added_by TEXT DEFAULT 'manual',
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(household_id, canonical_name)
);

ALTER TABLE pantry_items DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pantry_household ON pantry_items(household_id);
CREATE INDEX IF NOT EXISTS idx_pantry_canonical ON pantry_items(canonical_name);
