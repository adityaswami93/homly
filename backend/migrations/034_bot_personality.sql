-- Per-household bot personality + engagement settings.
--
-- Until now every household got the same assistant: the same name, the same
-- tone, and — more consequentially — the same rule about when it is allowed to
-- speak. That rule lived in agents/homly_graph.py's _classify_text() as a fixed
-- list of prefixes, and anything it didn't recognise routed to END with no
-- reply at all. These columns move that decision out of the code and into each
-- household's own settings row.
--
-- bot_engagement_mode is the load-bearing one. The bot sits in a shared family
-- WhatsApp group, so every message between household members reaches it too:
--
--   'mentioned' — only replies when actually addressed (@mention, a reply to
--                 one of its own messages, or its name in the text). Quietest.
--   'smart'     — DEFAULT. Replies when addressed, and to anything that reads
--                 like a request it can act on. Stays out of human-to-human
--                 chatter.
--   'always'    — replies to every text message in the group.
--
-- Receipts, fridge scans, and replies to a question the bot itself asked are
-- handled in every mode — see services/bot_profile.py's should_engage(), which
-- is the single place these semantics are enforced.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS bot_name              TEXT    NOT NULL DEFAULT 'Homly',
  ADD COLUMN IF NOT EXISTS bot_engagement_mode   TEXT    NOT NULL DEFAULT 'smart',
  ADD COLUMN IF NOT EXISTS bot_tone              TEXT    NOT NULL DEFAULT 'warm',
  ADD COLUMN IF NOT EXISTS bot_casual_chat       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS bot_proactive_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Widening these CHECKs later is safe; narrowing one is not while code still
-- writes the dropped value (see 026_pantry_fridge_source.sql / CLAUDE.md).
-- Both allow-lists are mirrored in services/bot_profile.py and validated by
-- PATCH /settings before they ever reach the database.
DO $$
BEGIN
  ALTER TABLE settings
    ADD CONSTRAINT settings_bot_engagement_mode_check
    CHECK (bot_engagement_mode IN ('mentioned', 'smart', 'always'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE settings
    ADD CONSTRAINT settings_bot_tone_check
    CHECK (bot_tone IN ('warm', 'concise', 'playful'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Existing rows predate these columns; the DEFAULTs above already backfilled
-- them, so every household starts on 'smart'/'warm' with casual chat on —
-- strictly more responsive than the old hard-coded behaviour, never less.
