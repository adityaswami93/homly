-- query_logs: tracks every /query call for debugging and intent discovery
-- Unhandled queries surface missing intents; agents_called helps with latency profiling.

CREATE TABLE IF NOT EXISTS query_logs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id  UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    query         TEXT        NOT NULL,
    agents_called TEXT[]      NOT NULL DEFAULT '{}',
    handled       BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_logs_household  ON query_logs (household_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_logs_unhandled  ON query_logs (created_at DESC) WHERE NOT handled;
