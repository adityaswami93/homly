-- Allow fridge_scan as a valid added_by value for pantry_items
ALTER TABLE pantry_items DROP CONSTRAINT IF EXISTS pantry_items_added_by_check;
ALTER TABLE pantry_items ADD CONSTRAINT pantry_items_added_by_check
  CHECK (added_by IN ('auto', 'manual', 'recipe', 'receipt', 'fridge_scan'));
