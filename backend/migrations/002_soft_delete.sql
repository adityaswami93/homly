ALTER TABLE receipts ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;

CREATE OR REPLACE VIEW weekly_totals AS
  SELECT user_id, year, week_number,
    SUM(total) AS total_amount, COUNT(*) AS receipt_count,
    COUNT(*) FILTER (WHERE flagged) AS flagged_count,
    MIN(date) AS week_start, MAX(date) AS week_end
  FROM receipts 
  WHERE deleted = false
  GROUP BY user_id, year, week_number;

CREATE OR REPLACE VIEW weekly_category_summary AS
  SELECT i.year, i.week_number, r.user_id, i.category,
    SUM(i.line_total) AS category_total,
    COUNT(DISTINCT i.receipt_id) AS receipt_count
  FROM items i JOIN receipts r ON r.id = i.receipt_id
  WHERE r.deleted = false
  GROUP BY i.year, i.week_number, r.user_id, i.category;