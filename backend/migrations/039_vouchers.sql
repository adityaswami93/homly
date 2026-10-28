-- Vouchers and promo codes the household is holding.
--
-- One-time codes and vouchers only: a voucher is either active, used, or
-- archived. Gift cards with a running balance are deliberately out of scope
-- (see documents/042-photo-memory-and-vouchers/implementation.md) -- there is no balance column to
-- decrement, and nothing here should pretend there is.
--
-- "Expired" is NOT a stored status. It is derived from expires_at against
-- today in the household's timezone by services/vouchers.py, the only place
-- that rule lives, so a voucher can never be "active" in the table but past
-- its date on the page, or the other way round.
--
-- Added three ways, all through services/vouchers.py's create_voucher():
--   * dashboard   -- POST /vouchers (typed, or confirmed from /vouchers/extract)
--   * whatsapp    -- a voucher photo (homly_graph.py's voucher_node), or a
--                    pasted promo message / "save code X" via the chat
--                    supervisor (agents/query/vouchers_agent.py)
--   * document    -- "save it as a voucher" in reply to a photo the assistant
--                    read (household_documents, migration 038)

CREATE TABLE IF NOT EXISTS vouchers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  merchant            TEXT NOT NULL,
  title               TEXT,
  code                TEXT,          -- NULL for barcode/QR-only vouchers: the image is the voucher
  kind                TEXT NOT NULL DEFAULT 'promo_code'
                      CHECK (kind IN ('promo_code', 'voucher', 'cashback', 'other')),
  value_type          TEXT CHECK (value_type IN ('amount', 'percent', 'freebie', 'other')),
  value               NUMERIC(10,2),
  currency            TEXT,
  min_spend           NUMERIC(10,2),
  terms               TEXT,
  expires_at          DATE,          -- last day it can be used; NULL = no stated expiry
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'used', 'archived')),
  used_at             TIMESTAMPTZ,
  used_by_name        TEXT,
  image_path          TEXT,          -- vouchers Storage bucket
  document_id         UUID REFERENCES household_documents(id) ON DELETE SET NULL,
  confidence          TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  source              TEXT NOT NULL DEFAULT 'dashboard'
                      CHECK (source IN ('dashboard', 'whatsapp', 'document')),
  added_by_name       TEXT,
  added_by_phone      TEXT,
  created_by          UUID REFERENCES auth.users(id),
  whatsapp_message_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backend-only, like every other table here: isolation is the
-- .eq("household_id") filter in services/vouchers.py.
ALTER TABLE vouchers DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vouchers_household_status
  ON vouchers(household_id, status, expires_at);

-- The same code for the same merchant is the same voucher, however many
-- times it gets forwarded into the group. Partial: code-less (barcode-only)
-- vouchers can't be deduplicated this way and aren't.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_household_code
  ON vouchers(household_id, lower(merchant), lower(code))
  WHERE code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_wa_id
  ON vouchers(household_id, whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

--
-- Wrapped so a role without rights on the storage schema doesn't fail the
-- whole migration: the table is the part that matters, and the bucket can be
-- created by hand (Storage -> New bucket -> 'vouchers', private) -- see release.md.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('vouchers', 'vouchers', false)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE USING MESSAGE = 'Could not create the vouchers Storage bucket, create it by hand: ' || SQLERRM;
END $$;
