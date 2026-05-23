-- Backfill price_history from existing items + receipts.
-- Safe to run multiple times: NOT EXISTS guard prevents duplicate rows.
-- Items with no unit_price are skipped (nothing useful to record).
-- canonical_name uses the item's canonical_name column if already set
-- (e.g. from a future LLM extraction), otherwise falls back to lower(trim(name)).

INSERT INTO price_history (
    household_id,
    receipt_id,
    item_id,
    canonical_name,
    brand,
    variant,
    category,
    vendor,
    unit_price,
    quantity,
    bought_at
)
SELECT
    i.household_id,
    i.receipt_id,
    i.id,
    COALESCE(NULLIF(TRIM(i.canonical_name), ''), LOWER(TRIM(i.name))),
    i.brand,
    i.variant,
    i.category,
    COALESCE(NULLIF(TRIM(i.vendor), ''), r.vendor),
    i.unit_price,
    COALESCE(i.qty, 1),
    COALESCE(i.receipt_date::date, r.date)
FROM items i
JOIN receipts r ON r.id = i.receipt_id
WHERE i.unit_price IS NOT NULL
  AND LOWER(TRIM(i.name)) <> ''
  AND r.deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM price_history ph WHERE ph.item_id = i.id
  );
