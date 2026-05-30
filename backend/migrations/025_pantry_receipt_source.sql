-- Allow receipt-scanned items as a pantry source (Phase 3 human-in-the-loop)
ALTER TABLE pantry_items DROP CONSTRAINT IF EXISTS pantry_items_added_by_check;
ALTER TABLE pantry_items ADD CONSTRAINT pantry_items_added_by_check
  CHECK (added_by IN ('manual', 'bot', 'recipe', 'receipt'));
