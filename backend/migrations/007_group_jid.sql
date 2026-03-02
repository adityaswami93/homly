-- Add group_jid to settings for reliable WhatsApp group routing
ALTER TABLE settings ADD COLUMN IF NOT EXISTS group_jid TEXT;

-- Make user_id nullable on receipts — receipts submitted via WhatsApp
-- are scoped to a household, not a specific platform user
ALTER TABLE receipts ALTER COLUMN user_id DROP NOT NULL;
