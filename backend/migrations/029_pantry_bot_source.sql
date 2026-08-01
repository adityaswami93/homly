-- Restore 'bot' as a valid added_by value for pantry_items.
-- Migration 026 rewrote the CHECK constraint and dropped 'bot' (swapping it
-- for an unused 'auto'), but backend/agents/query/pantry_agent.py still
-- writes added_by = 'bot' for every WhatsApp-driven pantry update. Since
-- migration 026, those upserts violate the CHECK constraint and silently
-- fail, so pantry items never update via WhatsApp.
ALTER TABLE pantry_items DROP CONSTRAINT IF EXISTS pantry_items_added_by_check;
ALTER TABLE pantry_items ADD CONSTRAINT pantry_items_added_by_check
  CHECK (added_by IN ('auto', 'manual', 'recipe', 'receipt', 'fridge_scan', 'bot'));
