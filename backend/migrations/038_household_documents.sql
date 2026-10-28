-- Photos the WhatsApp assistant has read, kept so they can be referred back to.
--
-- Until now a photo the vision classifier couldn't place as a receipt, a dish
-- or a fridge scan got a fixed "I can't tell what this photo is for" reply,
-- and all the transcript kept of it was "[sent a photo] <caption>"
-- (services/conversation.py). A school letter, a bill, a party invite or a
-- screenshot of a message was therefore unreadable *and* unrecallable: the
-- assistant could neither act on it nor answer "what did that letter say?"
-- the next day.
--
-- agents/homly_graph.py's read_image_node now reads such a photo
-- (agents/document_reader.py), stores the result here, and asks the group what
-- to do with it. agents/query/documents_agent.py searches this table, so the
-- chat supervisor can find a document in any later conversation -- long after
-- the 6-hour conversation window in services/conversation.py has moved on.
--
-- Only photos the assistant ENGAGED with land here (addressed, or the
-- household's engagement mode is 'always'). A family photo nobody asked the
-- bot about is never read or stored -- see documents/042-photo-memory-and-vouchers/implementation.md.
--
-- Rows expire. expires_at is set on insert from services/documents.py's
-- RETENTION_DAYS (a code-level setting, not a household setting), and
-- whatsapp_scheduler.py's daily purge deletes expired rows and their images.
-- It is a column rather than a computed cutoff so an individual row can be
-- kept longer (or shorter) without changing the global rule.

CREATE TABLE IF NOT EXISTS household_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  group_jid           TEXT,
  source              TEXT NOT NULL DEFAULT 'whatsapp' CHECK (source IN ('whatsapp', 'dashboard')),
  image_path          TEXT,          -- household-documents Storage bucket
  mime_type           TEXT,
  doc_type            TEXT,          -- letter / bill / invitation / notice / form / screenshot / photo / other
  title               TEXT NOT NULL,
  summary             TEXT,
  extracted_text      TEXT,
  key_facts           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{label, value}]
  suggested_actions   JSONB NOT NULL DEFAULT '[]'::jsonb,   -- what the group was offered
  caption             TEXT,
  sender_name         TEXT,
  sender_phone        TEXT,
  whatsapp_message_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  -- 'simple' rather than 'english': households write in more than one
  -- language, and stemming English rules onto Malay/Tamil/Chinese text does
  -- more harm than good. Exact-word matching is what "find the PSLE letter"
  -- needs anyway.
  search_tsv          TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig,
      coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' ||
      coalesce(caption, '') || ' ' || coalesce(extracted_text, ''))
  ) STORED
);

-- Backend service-role client only, via services/documents.py -- same posture
-- as conversation_messages. Household isolation is the .eq("household_id")
-- filter in that module.
ALTER TABLE household_documents DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_household_documents_recent
  ON household_documents(household_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_household_documents_search
  ON household_documents USING GIN (search_tsv);

CREATE INDEX IF NOT EXISTS idx_household_documents_expiry
  ON household_documents(expires_at);

-- A Baileys redelivery must not store (and announce) the same photo twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_household_documents_wa_id
  ON household_documents(household_id, whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- Private bucket for the original images. Only the backend reads it, and the
-- dashboard gets short-lived signed URLs.
--
-- Wrapped so a role without rights on the storage schema doesn't fail the
-- whole migration: the table is the part that matters, and the bucket can be
-- created by hand (Storage -> New bucket -> 'household-documents', private) -- see release.md.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('household-documents', 'household-documents', false)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE USING MESSAGE = 'Could not create the household-documents Storage bucket, create it by hand: ' || SQLERRM;
END $$;
