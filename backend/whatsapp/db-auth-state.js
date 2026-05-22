import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WA = require("baileys");
const { initAuthCreds, BufferJSON } = WA;

const TABLE = "whatsapp_auth";
const BATCH = 50;

// Serialize/deserialize with Baileys' Buffer-aware JSON codec
const enc = (v) => JSON.stringify(v, BufferJSON.replacer);
const dec = (s) => {
  try { return JSON.parse(s, BufferJSON.reviver); } catch { return null; }
};

export async function useSupabaseAuthState(tenantId, supabase) {
  // ── Load all rows into an in-memory cache ──────────────────
  const cache = {};
  try {
    const { data, error } = await supabase
      .from(TABLE).select("key, value").eq("tenant_id", tenantId);
    if (error) throw error;
    for (const row of data || []) cache[row.key] = row.value;
  } catch (e) {
    console.error("[auth] Failed to load auth state:", e.message);
  }

  // ── Helpers ────────────────────────────────────────────────
  async function upsertRows(rows) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase
        .from(TABLE)
        .upsert(rows.slice(i, i + BATCH), { onConflict: "tenant_id,key" });
      if (error) console.error("[auth] upsert error:", error.message);
    }
  }

  async function deleteKey(key) {
    const { error } = await supabase
      .from(TABLE).delete().eq("tenant_id", tenantId).eq("key", key);
    if (error) console.error("[auth] delete error:", error.message);
    delete cache[key];
  }

  // ── Credentials ────────────────────────────────────────────
  const rawCreds = cache["creds"];
  const creds = rawCreds ? dec(rawCreds) : initAuthCreds();
  if (!rawCreds) {
    // Persist fresh creds immediately so the next boot loads them
    const encoded = enc(creds);
    cache["creds"] = encoded;
    await upsertRows([{ tenant_id: tenantId, key: "creds", value: encoded }]);
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
              writes.push({ tenant_id: tenantId, key: k, value: encoded });
            } else {
              delete cache[k];
              deletes.push(k);
            }
          }
        }
        if (writes.length) await upsertRows(writes);
        for (const k of deletes) {
          await supabase.from(TABLE).delete()
            .eq("tenant_id", tenantId).eq("key", k);
        }
      },

      clear: async () => {
        const { error } = await supabase
          .from(TABLE).delete()
          .eq("tenant_id", tenantId).neq("key", "creds");
        if (error) console.error("[auth] clear error:", error.message);
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
    await upsertRows([{ tenant_id: tenantId, key: "creds", value: encoded }]);
  }

  async function deleteSession() {
    const { error } = await supabase
      .from(TABLE).delete().eq("tenant_id", tenantId);
    if (error) console.error("[auth] deleteSession error:", error.message);
    Object.keys(cache).forEach((k) => delete cache[k]);
  }

  // Flush creds on clean shutdown
  async function flush() {
    await saveCreds();
  }

  return { state, saveCreds, deleteSession, flush };
}
