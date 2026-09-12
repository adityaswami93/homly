import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WA = require("baileys");
const { initAuthCreds, BufferJSON } = WA;

const BATCH = 50;

// Serialize/deserialize with Baileys' Buffer-aware JSON codec
const enc = (v) => JSON.stringify(v, BufferJSON.replacer);
const dec = (s) => {
  try { return JSON.parse(s, BufferJSON.reviver); } catch { return null; }
};

/**
 * Baileys auth state persisted through the backend's /internal/wa-auth/*
 * endpoints (api/routers/wa_auth.py).
 *
 * This used to take a service-role Supabase client and talk to the
 * `whatsapp_auth` table directly. That meant this process — which parses
 * untrusted input from the public internet via Baileys — held a credential
 * that bypasses RLS on every table in the project, to read and write one
 * table. It goes through the backend now, authenticated with INTERNAL_KEY,
 * which is scoped to /internal/* and revocable without rotating the database.
 *
 * `api` is an axios instance already carrying the X-Internal-Key header.
 */
export async function useSupabaseAuthState(tenantId, api) {
  // ── Load all rows into an in-memory cache ──────────────────
  const cache = {};
  try {
    const { data } = await api.get("/internal/wa-auth", { params: { tenant_id: tenantId } });
    for (const row of data?.rows || []) cache[row.key] = row.value;
  } catch (e) {
    // Same posture as before: a failed load means "no session", so the bot
    // falls through to a fresh QR pairing rather than crashing on boot.
    console.error("[auth] Failed to load auth state:", e.message);
  }

  // ── Helpers ────────────────────────────────────────────────
  async function upsertRows(rows) {
    for (let i = 0; i < rows.length; i += BATCH) {
      try {
        await api.post("/internal/wa-auth/upsert", {
          tenant_id: tenantId,
          rows: rows.slice(i, i + BATCH),
        });
      } catch (e) {
        console.error("[auth] upsert error:", e.message);
      }
    }
  }

  async function deleteKeys(keys) {
    if (!keys.length) return;
    try {
      await api.post("/internal/wa-auth/delete", { tenant_id: tenantId, keys });
    } catch (e) {
      console.error("[auth] delete error:", e.message);
    }
    for (const k of keys) delete cache[k];
  }

  // ── Credentials ────────────────────────────────────────────
  const rawCreds = cache["creds"];
  const creds = rawCreds ? dec(rawCreds) : initAuthCreds();
  if (!rawCreds) {
    // Persist fresh creds immediately so the next boot loads them
    const encoded = enc(creds);
    cache["creds"] = encoded;
    await upsertRows([{ key: "creds", value: encoded }]);
  }

  // ── State object ───────────────────────────────────────────
  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const result = {};
        for (const id of ids) {
          const raw = cache[`${type}|${id}`];
          if (raw !== undefined) {
            const parsed = dec(raw);
            if (parsed !== null) result[id] = parsed;
          }
        }
        return result;
      },

      set: async (data) => {
        const writes = [];
        const deletes = [];
        for (const [type, ids] of Object.entries(data)) {
          for (const [id, value] of Object.entries(ids || {})) {
            const k = `${type}|${id}`;
            if (value) {
              const encoded = enc(value);
              cache[k] = encoded;
              writes.push({ key: k, value: encoded });
            } else {
              delete cache[k];
              deletes.push(k);
            }
          }
        }
        if (writes.length) await upsertRows(writes);
        // Batched into one call — this used to issue one DELETE per key.
        await deleteKeys(deletes);
      },

      clear: async () => {
        try {
          await api.post("/internal/wa-auth/clear", { tenant_id: tenantId, keep_creds: true });
        } catch (e) {
          console.error("[auth] clear error:", e.message);
        }
        for (const k of Object.keys(cache)) {
          if (k !== "creds") delete cache[k];
        }
      },
    },
  };

  // ── Exported helpers ───────────────────────────────────────
  async function saveCreds() {
    const encoded = enc(state.creds);
    cache["creds"] = encoded;
    await upsertRows([{ key: "creds", value: encoded }]);
  }

  async function deleteSession() {
    try {
      await api.post("/internal/wa-auth/clear", { tenant_id: tenantId, keep_creds: false });
    } catch (e) {
      console.error("[auth] deleteSession error:", e.message);
    }
    Object.keys(cache).forEach((k) => delete cache[k]);
  }

  // Flush creds on clean shutdown
  async function flush() {
    await saveCreds();
  }

  return { state, saveCreds, deleteSession, flush };
}
