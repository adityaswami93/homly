-- 029_mcp_api_keys.sql: per-household API keys for the MCP data-query server
-- (backend/mcp_server/), generated from the web portal's Settings > MCP tab.
-- Only a salted hash is ever stored — the plaintext key is shown once, at
-- creation time, and never persisted.

CREATE TABLE IF NOT EXISTS mcp_api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  key_hash     TEXT        NOT NULL UNIQUE,
  key_prefix   TEXT        NOT NULL,  -- first few chars, shown in the UI to tell keys apart
  label        TEXT,
  created_by   UUID        REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

-- Disabled like the other service-key-adjacent tables (receipts, items, ...) —
-- lookups happen via the service role key in api/routers/mcp_data.py, scoped
-- to household_id in application code, not via RLS.
ALTER TABLE mcp_api_keys DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_household ON mcp_api_keys (household_id);
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_hash      ON mcp_api_keys (key_hash);
