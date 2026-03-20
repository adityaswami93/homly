-- 019_whatsapp_sessions.sql
--
-- Stores the full Baileys WhatsApp auth state (creds + signal keys) as a
-- single JSONB blob per bot tenant.
--
-- Replaces Supabase Storage (whatsapp-auth bucket) which caused a runaway
-- loop of 4M+ Storage API requests in 24 h because creds.update fires on
-- every Signal Protocol key exchange, not just on login.
--
-- Write volume with the new approach:
--   • creds.update fires ~5-20 times per active day (key rotation events)
--   • A 5-second debounce collapses bursts → ≤ 1 DB write per burst
--   • Expected: < 50 UPSERTs / tenant / day  (vs 4M+ Storage calls)

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  tenant_id  TEXT        PRIMARY KEY,
  auth_state JSONB       NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS.  No explicit policies are defined, so:
--   • Service-role key (used by the WhatsApp bot)  → bypasses RLS entirely ✓
--   • Anon / authenticated users                   → denied by default     ✓
--   • No client-side access to session keys is possible.
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- Index so we can quickly look up by tenant even if the table grows
-- (not strictly needed for PRIMARY KEY lookups, but explicit for clarity).
-- Postgres already creates a B-tree index on the PK, so this is a no-op
-- in terms of functionality; keep the comment for documentation.

COMMENT ON TABLE whatsapp_sessions IS
  'Baileys WhatsApp auth state (one row per bot tenant). '
  'Written via debounced UPSERT; read once on bot startup. '
  'Service-role only (RLS, no client policies).';
