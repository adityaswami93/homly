CREATE TABLE IF NOT EXISTS receipts (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor                TEXT,
  date                  DATE,
  subtotal              NUMERIC(10,2),
  tax                   NUMERIC(10,2),
  total                 NUMERIC(10,2),
  currency              TEXT DEFAULT 'SGD',
  confidence            TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  notes                 TEXT,
  image_filename        TEXT,
  whatsapp_message_id   TEXT UNIQUE,
  week_number           INT,
  year                  INT,
  flagged               BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS items (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id    UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  qty           NUMERIC(8,3) DEFAULT 1,
  unit_price    NUMERIC(10,2),
  line_total    NUMERIC(10,2),
  category      TEXT CHECK (category IN (
                  'groceries','household','personal care',
                  'food & beverage','transport','other'
                )),
  vendor        TEXT,
  receipt_date  DATE,
  week_number   INT,
  year          INT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE VIEW weekly_totals AS
  SELECT user_id, year, week_number,
    SUM(total) AS total_amount, COUNT(*) AS receipt_count,
    COUNT(*) FILTER (WHERE flagged) AS flagged_count,
    MIN(date) AS week_start, MAX(date) AS week_end
  FROM receipts GROUP BY user_id, year, week_number;

CREATE OR REPLACE VIEW weekly_category_summary AS
  SELECT i.year, i.week_number, r.user_id, i.category,
    SUM(i.line_total) AS category_total,
    COUNT(DISTINCT i.receipt_id) AS receipt_count
  FROM items i JOIN receipts r ON r.id = i.receipt_id
  GROUP BY i.year, i.week_number, r.user_id, i.category;

CREATE INDEX IF NOT EXISTS idx_receipts_user_week ON receipts(user_id, year, week_number);
CREATE INDEX IF NOT EXISTS idx_receipts_whatsapp_msg ON receipts(whatsapp_message_id);
CREATE INDEX IF NOT EXISTS idx_items_receipt ON items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_items_week ON items(year, week_number);

ALTER TABLE receipts DISABLE ROW LEVEL SECURITY;
ALTER TABLE items    DISABLE ROW LEVEL SECURITY;
