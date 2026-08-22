-- Household chores/tasks + domestic helper management (Task 030)

CREATE TABLE IF NOT EXISTS chores (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id     UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    notes            TEXT,
    recurrence       TEXT NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once', 'daily', 'weekly')),
    days_of_week     INT[],           -- weekly recurrence; 0=Mon..6=Sun (matches settings.summary_day)
    due_date         DATE,            -- for recurrence='once'
    active           BOOLEAN NOT NULL DEFAULT true,
    created_by       UUID REFERENCES auth.users(id),
    source           TEXT NOT NULL DEFAULT 'dashboard' CHECK (source IN ('dashboard', 'whatsapp', 'agent')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE chores DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_chores_household ON chores(household_id);

-- One row per completed/skipped occurrence; absence of a row for today = still pending.
CREATE TABLE IF NOT EXISTS chore_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chore_id            UUID NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
    household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    log_date            DATE NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('done', 'skipped')),
    completed_by_name   TEXT,
    completed_by_phone  TEXT,
    source              TEXT NOT NULL DEFAULT 'dashboard' CHECK (source IN ('dashboard', 'whatsapp')),
    completed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chore_id, log_date)
);

ALTER TABLE chore_logs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_chore_logs_household_date ON chore_logs(household_id, log_date);

-- Helper leave / off-day requests (ad-hoc, on top of the recurring off_days on helper_profile)
CREATE TABLE IF NOT EXISTS helper_leave_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    reason              TEXT,
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
    requested_by_name   TEXT,
    requested_by_phone  TEXT,
    source              TEXT NOT NULL DEFAULT 'whatsapp' CHECK (source IN ('dashboard', 'whatsapp')),
    decided_by           UUID REFERENCES auth.users(id),
    decided_at           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE helper_leave_requests DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_helper_leave_requests_household ON helper_leave_requests(household_id);

-- Captured once at onboarding, editable later; drives cron skip-days and gives the LLM
-- composer/suggester context about the household without re-asking every time.
CREATE TABLE IF NOT EXISTS helper_profile (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id         UUID NOT NULL UNIQUE REFERENCES households(id) ON DELETE CASCADE,
    has_helper           BOOLEAN NOT NULL DEFAULT true,
    helper_name          TEXT,
    duties_description   TEXT,          -- raw free text from onboarding, kept for future re-generation
    off_days             INT[] NOT NULL DEFAULT '{}',  -- recurring weekly off days, 0=Mon..6=Sun
    onboarded_at         TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE helper_profile DISABLE ROW LEVEL SECURITY;

-- Allow helper/chore-originated shopping list items alongside auto/manual/recipe
ALTER TABLE shopping_list DROP CONSTRAINT IF EXISTS shopping_list_added_by_check;
ALTER TABLE shopping_list ADD CONSTRAINT shopping_list_added_by_check
    CHECK (added_by IN ('auto', 'manual', 'recipe', 'helper'));
