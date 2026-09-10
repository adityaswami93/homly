-- Records which landing-page hero variant a waitlist signup came from, so the
-- concierge-vs-pain headline test can be settled by conversion data rather than
-- argument. Nullable: signups from before this column existed, and any client
-- that omits it, stay valid.
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS variant TEXT;

-- Signups are read in aggregate ("how did each variant convert?"), so index the
-- column the grouping runs on.
CREATE INDEX IF NOT EXISTS idx_waitlist_variant ON waitlist (variant);
