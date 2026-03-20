"use strict";

/**
 * useSupabaseAuthState(tenantId, supabase)
 *
 * Drop-in replacement for Baileys' useMultiFileAuthState, backed by a
 * single Postgres row (JSONB) instead of Supabase Storage.
 *
 * Root cause of the old runaway:
 *   Baileys fires `creds.update` on every Signal Protocol key exchange
 *   (pre-keys, sender-keys, session keys).  The old code uploaded *every
 *   file in the auth_state/ directory* on each event → thousands of
 *   Storage API calls per hour.
 *
 * This implementation:
 *   • Keeps the full auth state (creds + all key types) in memory.
 *   • On any change, sets a dirty flag and arms a 5-second debounce timer.
 *   • The timer fires at most once per burst → one UPSERT to Postgres.
 *   • Reads once on startup; deletes the row on logout.
 *
 * Expected write volume: < 50 UPSERTs / tenant / day.
 *
 * @param {string} tenantId   - Primary key in whatsapp_sessions (e.g. "default")
 * @param {object} supabase   - Supabase client initialised with the service-role key
 * @returns {{ state, saveCreds, deleteSession, flush }}
 */

const { initAuthCreds, BufferJSON } = require("baileys");

const WRITE_DEBOUNCE_MS = 5_000; // collapse burst writes to ≤ 1 per 5 s

async function useSupabaseAuthState(tenantId, supabase) {
  // ── 1. Load existing session from DB ──────────────────────────────────────
  let creds;
  let keys = {};

  const { data: row, error: loadErr } = await supabase
    .from("whatsapp_sessions")
    .select("auth_state")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (loadErr) {
    console.error("[auth-state] Failed to load session:", loadErr.message);
  }

  if (row?.auth_state) {
    try {
      // Postgres returns plain JS objects; re-hydrate Buffers via BufferJSON.reviver
      const revived = JSON.parse(JSON.stringify(row.auth_state), BufferJSON.reviver);
      creds = revived.creds;
      keys  = revived.keys ?? {};
      console.log(`[auth-state] Session restored for tenant "${tenantId}"`);
    } catch (e) {
      console.error("[auth-state] Corrupt session data — starting fresh:", e.message);
      creds = initAuthCreds();
      keys  = {};
    }
  } else {
    console.log(`[auth-state] No session found for tenant "${tenantId}" — fresh start`);
    creds = initAuthCreds();
    keys  = {};
  }

  // ── 2. Debounced DB writer ─────────────────────────────────────────────────
  let dirty = false;
  let timer = null;

  async function flushToDb() {
    if (!dirty) return;
    dirty = false;
    try {
      // Serialise Buffers so Postgres can store them as plain JSON
      const payload = JSON.parse(JSON.stringify({ creds, keys }, BufferJSON.replacer));
      const { error } = await supabase
        .from("whatsapp_sessions")
        .upsert(
          { tenant_id: tenantId, auth_state: payload, updated_at: new Date().toISOString() },
          { onConflict: "tenant_id" }
        );
      if (error) {
        console.error("[auth-state] DB write failed:", error.message);
        dirty = true; // will retry on next scheduleWrite
      }
    } catch (e) {
      console.error("[auth-state] DB write exception:", e.message);
      dirty = true;
    }
  }

  function scheduleWrite() {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flushToDb, WRITE_DEBOUNCE_MS);
  }

  // ── 3. In-memory key store (implements the Baileys KeyStore interface) ─────
  const keyStore = {
    /**
     * get(type, ids) → { [id]: value }
     * Called by Baileys when it needs to decrypt an incoming message.
     */
    get(type, ids) {
      return ids.reduce((acc, id) => {
        const val = keys[type]?.[id];
        if (val !== undefined && val !== null) acc[id] = val;
        return acc;
      }, {});
    },

    /**
     * set(data) — called when Baileys generates or rotates keys.
     * data: { [type]: { [id]: value | null } }
     * null value means "delete this key".
     */
    set(data) {
      for (const [type, updates] of Object.entries(data)) {
        if (!keys[type]) keys[type] = {};
        for (const [id, value] of Object.entries(updates)) {
          if (value) {
            keys[type][id] = value;
          } else {
            delete keys[type][id];
          }
        }
      }
      scheduleWrite();
    },

    /** clear() — called when the session is fully reset (rare). */
    clear() {
      keys = {};
      scheduleWrite();
    },
  };

  const state = { creds, keys: keyStore };

  // ── 4. saveCreds — Baileys calls this when identity creds change ──────────
  function saveCreds() {
    scheduleWrite();
  }

  // ── 5. deleteSession — call when the bot is logged out ────────────────────
  async function deleteSession() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    dirty = false;
    const { error } = await supabase
      .from("whatsapp_sessions")
      .delete()
      .eq("tenant_id", tenantId);
    if (error) {
      console.error("[auth-state] Failed to delete session:", error.message);
    } else {
      console.log(`[auth-state] Session deleted for tenant "${tenantId}"`);
    }
  }

  // ── 6. flush — explicit flush (use before process exit) ───────────────────
  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await flushToDb();
  }

  return { state, saveCreds, deleteSession, flush };
}

module.exports = { useSupabaseAuthState };
