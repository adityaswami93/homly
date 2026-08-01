-- 029_api_keys.sql: per-household API keys for programmatic access — currently
-- issued for the MCP data-query server (backend/mcp_server/), generated from
-- the web portal's Settings > MCP tab, but the table is generic (`scope`
-- distinguishes use cases) so future integrations (a public API, Zapier,
-- etc.) can reuse it instead of growing their own key table. Only a hash is
-- ever stored — the plaintext key is shown once, at creation time, and
-- never persisted.

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  scope        TEXT        NOT NULL DEFAULT 'mcp',  -- which integration this key is for, e.g. 'mcp'
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
-- to household_id (and scope) in application code, not via RLS.
ALTER TABLE api_keys DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_api_keys_household ON api_keys (household_id, scope);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash      ON api_keys (key_hash);
