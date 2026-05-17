import "dotenv/config";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const {
  default: makeWASocket,
  DisconnectReason,
  downloadMediaMessage,
  Browsers,
} = require("baileys");
import { Boom } from "@hapi/boom";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import axios from "axios";
import FormData from "form-data";
import cron from "node-cron";
import pino from "pino";
import QRCode from "qrcode";
import { useSupabaseAuthState } from "./db-auth-state.js";

const FASTAPI_URL  = process.env.FASTAPI_URL  || "http://localhost:8000";
const INTERNAL_KEY = process.env.INTERNAL_KEY || "homly-internal";
const SERVICE_KEY  = process.env.SUPABASE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const BOT_TENANT_ID = process.env.BOT_TENANT_ID || "default";

if (!SERVICE_KEY) {
  console.error("Missing required env var: SUPABASE_KEY");
  process.exit(1);
}
if (!SUPABASE_URL) {
  console.error("Missing required env var: SUPABASE_URL");
  process.exit(1);
}

// Supabase client (service-role) — used for auth state persistence only
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  realtime: { transport: ws },
});

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"
]);

// groupJid → { household_id, settings }
const groupMap = new Map();
// household_id → cron job
const cronJobs = new Map();
// current active socket (set on every startSock call)
let currentSock = null;
// exposed so the QR-reset poller can wipe the session before reconnecting
let deleteCurrentSession = null;
// phone number to pair with on next startSock (set by QR-status poller)
let pendingPairingPhone = null;
// consecutive connection failures (resets on successful open)
let connectionFailures = 0;

// ── Settings ────────────────────────────────────────────────
async function fetchAllSettings() {
  try {
    const res = await axios.get(`${FASTAPI_URL}/internal/settings`, {
      headers: { "X-Internal-Key": INTERNAL_KEY }
    });
    return Array.isArray(res.data) ? res.data : [res.data];
  } catch (e) {
    console.error("Failed to fetch settings:", e.message);
    return [];
  }
}

function buildGroupMap(allSettings, knownGroupJids) {
  groupMap.clear();
  for (const s of allSettings) {
    if (s.group_jid && s.household_id && knownGroupJids.has(s.group_jid)) {
      groupMap.set(s.group_jid, { household_id: s.household_id, settings: s });
    }
  }
  console.log(`Group map built: ${groupMap.size} household(s) active`);
}

// day: 0=Monday..6=Sunday → cron day
function daytoCron(day) {
  // Our day: 0=Mon,1=Tue,2=Wed,3=Thu,4=Fri,5=Sat,6=Sun
  // Cron day: 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  const map = [1, 2, 3, 4, 5, 6, 0];
  return map[day];
}

function scheduleAllSummaries(sock) {
  for (const job of cronJobs.values()) job.stop();
  cronJobs.clear();

  for (const [groupJid, { household_id, settings }] of groupMap.entries()) {
    const { summary_day, summary_hour, summary_timezone } = settings;
    const cronExpr = `0 ${summary_hour} * * ${daytoCron(summary_day)}`;

    const job = cron.schedule(cronExpr, async () => {
      const entry = groupMap.get(groupJid);
      if (entry) {
        await sendWeeklySummary(sock, groupJid, entry.household_id, entry.settings.cutoff_mode);
      }
    }, { timezone: summary_timezone });

    cronJobs.set(household_id, job);
    console.log(`Scheduled summary for household ${household_id}: cron="${cronExpr}" tz="${summary_timezone}"`);
  }
}

// ── QR / connection helpers ─────────────────────────────────
let lastQRImageUrl = null;

async function pushQR(qrData) {
  let qrImageUrl;
  try {
    qrImageUrl = await QRCode.toDataURL(qrData);
  } catch (e) {
    console.error("Failed to convert QR to image:", e.message);
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(`${FASTAPI_URL}/internal/qr`,
        { qr: qrImageUrl, connected: false },
        { headers: { "X-Internal-Key": INTERNAL_KEY } }
      );
      lastQRImageUrl = qrImageUrl;
      return;
    } catch (e) {
      const detail = e.response ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}` : e.message;
      console.error(`Failed to push QR (attempt ${attempt}/3): ${detail}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

async function pushPairingCode(code) {
  try {
    await axios.post(`${FASTAPI_URL}/internal/pairing-code`,
      { code },
      { headers: { "X-Internal-Key": INTERNAL_KEY } }
    );
    console.log(`[pairing] Code pushed to dashboard: ${code}`);
  } catch (e) {
    console.error("[pairing] Failed to push pairing code:", e.message);
  }
}

async function pushConnected(groups) {
  lastQRImageUrl = null;
  try {
    await axios.post(`${FASTAPI_URL}/internal/connected`,
      { connected: true, groups },
      { headers: { "X-Internal-Key": INTERNAL_KEY } }
    );
  } catch (e) {
    console.error("Failed to push connected state:", e.message);
  }
}

// ── Receipt processing ──────────────────────────────────────
async function processReceiptImage(msg, sock) {
  const groupJid = msg.key.remoteJid;
  const entry = groupMap.get(groupJid);
  if (!entry) {
    console.warn(`No household mapped for group ${groupJid} — ignoring receipt`);
    return;
  }
  const { household_id } = entry;

  const msgId   = msg.key.id;
  const msgInfo = msg.message;

  const imgMsg =
    msgInfo.imageMessage ||
    msgInfo.viewOnceMessage?.message?.imageMessage ||
    msgInfo.viewOnceMessageV2?.message?.imageMessage;

  if (!imgMsg) return;

  const mimeType = imgMsg.mimetype || "image/jpeg";
  if (!IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) return;

  const senderJid   = msg.key.participant || groupJid;
  const senderPhone = senderJid.includes("@") ? senderJid.split("@")[0] : senderJid || null;
  const pushName    = msg.pushName || null;

  console.log(`Receipt from ${pushName || senderPhone} — msg=${msgId} → household=${household_id}`);

  try {
    const buffer = await downloadMediaMessage(
      msg, "buffer", {},
      { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
    );

    const form = new FormData();
    form.append("file", buffer, { filename: "receipt.jpg", contentType: mimeType });
    form.append("whatsapp_message_id", msgId);
    form.append("household_id", household_id);
    if (pushName)    form.append("sender_name",  pushName);
    if (senderPhone) form.append("sender_phone", senderPhone);

    const res = await axios.post(`${FASTAPI_URL}/process-receipt`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${SERVICE_KEY}` },
      timeout: 60000,
    });

    const { vendor, total, confidence, flagged } = res.data;

    await sock.sendMessage(groupJid, { react: { text: "✅", key: msg.key } });

    if (flagged) {
      await sock.sendMessage(groupJid, {
        text: `Receipt from ${pushName || senderPhone} captured but needs a manual check.\nVendor: ${vendor || "unknown"}, Total: ${total ? `SGD ${total}` : "unreadable"}`,
      });
    }

    console.log(`Receipt saved — ${vendor || "unknown"}, SGD ${total ?? "?"}, confidence: ${confidence}`);
  } catch (err) {
    console.error(`Failed to process receipt ${msgId}:`, err.response?.data || err.message);
  }
}

// ── Weekly summary ──────────────────────────────────────────
async function sendWeeklySummary(sock, groupJid, householdId, cutoffMode = "last7days") {
  console.log(`Sending summary to ${groupJid} (household: ${householdId}, mode: ${cutoffMode})...`);
  try {
    const endpoint = cutoffMode === "last7days" ? "/summary/last7days" : "/this-week";
    const res = await axios.get(`${FASTAPI_URL}${endpoint}`, {
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      params: { household_id: householdId },
    });

    const data = res.data;
    const receipts        = (data.receipts || []).filter(r => r.reimbursable !== false);
    const category_totals = data.category_totals;
    const total           = data.reimbursable_total ?? data.total;
    const flagged_count   = receipts.filter(r => r.flagged).length;
    const week_number     = data.week_number;
    const year            = data.year;
    const date_from       = data.date_from;
    const date_to         = data.date_to;

    if (!receipts || receipts.length === 0) {
      await sock.sendMessage(groupJid, { text: "No receipts recorded in this period." });
      return;
    }

    const receiptLines = receipts.map((r) => {
      const d = r.date
        ? new Date(r.date).toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" })
        : "Unknown date";
      const amt = r.total != null ? `SGD ${Number(r.total).toFixed(2)}` : "amount unclear";
      const sender = r.sender_name ? ` (${r.sender_name})` : "";
      return `${d}  ${r.vendor || "Unknown vendor"}${sender}\n  ${amt}${r.flagged ? " ⚠️" : " ✓"}`;
    }).join("\n");

    const CATEGORY_EMOJI = {
      "groceries": "🛒", "household": "🏠", "personal care": "🧴",
      "food & beverage": "🍜", "transport": "🚌", "other": "📦",
    };

    const categoryLines = Object.entries(category_totals)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, amt]) => `${CATEGORY_EMOJI[cat] || "•"} ${cat.charAt(0).toUpperCase() + cat.slice(1)}: SGD ${Number(amt).toFixed(2)}`)
      .join("\n");

    const flagNote = flagged_count > 0
      ? `\n⚠️ ${flagged_count} receipt${flagged_count > 1 ? "s" : ""} need${flagged_count === 1 ? "s" : ""} manual check`
      : "";

    const periodLabel = cutoffMode === "last7days" && date_from && date_to
      ? `${date_from} – ${date_to}`
      : `Week ${week_number}, ${year}`;

    const message = [
      `📋 *Expense Summary*`,
      periodLabel,
      `━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `*Receipts:*`,
      receiptLines,
      ``,
      `*By Category:*`,
      categoryLines || "No categorised items",
      ``,
      `━━━━━━━━━━━━━━━━━━━━`,
      `💰 *Total to reimburse: SGD ${Number(total).toFixed(2)}*${flagNote}`,
    ].join("\n");

    await sock.sendMessage(groupJid, { text: message });
    console.log(`Summary sent to ${groupJid}`);
  } catch (err) {
    console.error("Failed to send summary:", err.response?.data || err.message);
  }
}

// ── Shopping list command ────────────────────────────────────
async function handleShoppingListCommand(sock, jid) {
  try {
    const res = await axios.get(`${FASTAPI_URL}/internal/shopping-list`, {
      headers: { "X-Internal-Key": INTERNAL_KEY }
    });
    const { items, suggestions } = res.data;
    const lines = [];

    if (items.length > 0) {
      lines.push("🛒 *Shopping List*");
      items.forEach(item => {
        const variant = item.variant ? ` (${item.variant})` : "";
        lines.push(`• ${item.canonical_name}${variant}`);
      });
    }

    if (suggestions.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("📋 *Suggested — running low:*");
      suggestions.forEach(s => {
        const variant  = s.variant ? ` (${s.variant})` : "";
        const urgency  = s.urgency === "overdue"
          ? `overdue by ${Math.abs(s.days_until)}d`
          : `due in ${s.days_until}d`;
        lines.push(`• ${s.canonical_name}${variant} — ${urgency}`);
      });
    }

    if (lines.length === 0) {
      await sock.sendMessage(jid, { text: "No items on your shopping list and nothing looks low on stock yet." });
      return;
    }
    await sock.sendMessage(jid, { text: lines.join("\n") });
  } catch (e) {
    console.error("Shopping list command failed:", e.message);
  }
}

// ── Coverage gap query ───────────────────────────────────────
const GAP_KEYWORDS = [
  "what am i missing", "coverage gap", "gap analysis",
  "what should i get", "missing insurance", "underinsured"
];
function isGapQuery(text) { return GAP_KEYWORDS.some(kw => text.includes(kw)); }

async function handleGapQuery(sock, jid, householdId) {
  try {
    const res = await axios.get(`${FASTAPI_URL}/insurance/gaps`, {
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      params: { household_id: householdId }
    });
    const { profile_complete, gaps } = res.data;

    if (!profile_complete) {
      await sock.sendMessage(jid, { text: "To get a personalised coverage gap analysis, please complete your household profile on the Homly dashboard (Insurance → Gaps)." });
      return;
    }
    if (!gaps || gaps.length === 0) {
      await sock.sendMessage(jid, { text: "✅ Your household coverage looks complete for your life stage. No significant gaps identified." });
      return;
    }

    const critical    = gaps.filter(g => g.priority === "critical");
    const recommended = gaps.filter(g => g.priority === "recommended");
    const lines = ["🛡️ *Coverage Gap Summary*", "", "Your household may be missing:", ""];

    if (critical.length > 0) {
      lines.push("🔴 *Critical*");
      for (const g of critical) lines.push(`- ${g.label} — ${g.explanation}`);
      lines.push("");
    }
    if (recommended.length > 0) {
      lines.push("🟡 *Recommended*");
      for (const g of recommended) lines.push(`- ${g.label} — ${g.explanation}`);
      lines.push("");
    }
    lines.push("Visit the Homly dashboard to add policies or ask me more about any of these.");
    await sock.sendMessage(jid, { text: lines.join("\n").trim() });
  } catch (e) {
    console.error("Gap query failed:", e.message);
  }
}

// ── Insurance query ──────────────────────────────────────────
const INSURANCE_KEYWORDS = [
  "insurance", "policy", "policies", "health insurance", "life insurance",
  "car insurance", "home insurance", "travel insurance"
];
function isInsuranceQuery(text) { return INSURANCE_KEYWORDS.some(kw => text.includes(kw)); }
function detectCoverageTypeFilter(text) {
  return ["health", "life", "home", "car", "travel"].find(t => text.includes(t)) || null;
}

async function handleInsuranceQuery(sock, jid, householdId, text) {
  try {
    const res = await axios.get(`${FASTAPI_URL}/insurance`, {
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      params: { household_id: householdId }
    });
    const all = res.data || [];
    const typeFilter = detectCoverageTypeFilter(text);
    const policies = typeFilter ? all.filter(p => p.coverage_type === typeFilter) : all;

    if (policies.length === 0) {
      await sock.sendMessage(jid, { text: "No insurance policies added yet. Visit the Homly dashboard to add your policies." });
      return;
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const grouped = {};
    for (const p of policies) {
      if (!grouped[p.coverage_type]) grouped[p.coverage_type] = [];
      grouped[p.coverage_type].push(p);
    }

    const lines = ["🛡️ *Household Insurance Policies*", ""];
    for (const [type, items] of Object.entries(grouped)) {
      lines.push(`*${type.toUpperCase()}*`);
      for (const p of items) {
        lines.push(`- ${p.provider}${p.insured_person ? ` (${p.insured_person})` : ""}`);
        if (p.policy_number) lines.push(`  Policy #: ${p.policy_number}`);
        const coverage = p.coverage_amount ? `$${Number(p.coverage_amount).toLocaleString()}` : "—";
        const premium  = p.premium_amount ? `$${Number(p.premium_amount).toFixed(0)}/${p.premium_frequency ?? "mo"}` : "—";
        lines.push(`  Coverage: ${coverage} | Premium: ${premium}`);
        if (p.renewal_date) {
          const renewal = new Date(p.renewal_date);
          const days = Math.ceil((renewal.getTime() - today.getTime()) / 86400000);
          const dateStr = renewal.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
          lines.push(`  Renews: ${dateStr} (${days > 0 ? `${days} days` : "overdue"})`);
        }
      }
      lines.push("");
    }
    if (!typeFilter) lines.push('Reply with a type to filter, e.g. "health insurance"');
    await sock.sendMessage(jid, { text: lines.join("\n").trim() });
  } catch (e) {
    console.error("Insurance query failed:", e.message);
  }
}

// ── Insurance renewal reminder (daily at 09:00 SGT) ─────────
cron.schedule("0 9 * * *", async () => {
  console.log("[renewal-reminder] Running daily insurance renewal check...");
  try {
    const res = await axios.get(`${FASTAPI_URL}/internal/insurance/renewals`, {
      headers: { "X-Internal-Key": INTERNAL_KEY }
    });
    const renewals = res.data || [];
    if (renewals.length === 0) return;

    for (const policy of renewals) {
      const entry = [...groupMap.values()].find(e => e.household_id === policy.household_id);
      if (!entry || !entry.settings?.group_jid) continue;

      const groupJid    = entry.settings.group_jid;
      const days        = policy.days_until_renewal;
      const renewalDate = policy.renewal_date
        ? new Date(policy.renewal_date).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })
        : "—";
      const premium = policy.premium_amount
        ? `$${Number(policy.premium_amount).toFixed(2)} / ${policy.premium_frequency ?? "period"}`
        : "—";

      const msg = [
        "🔔 *Insurance Renewal Reminder*", "",
        `Your *${policy.coverage_type}* insurance with *${policy.provider}* renews in *${days} days* (${renewalDate}).`, "",
        `Policy #: ${policy.policy_number || "—"}`,
        `Premium: ${premium}`, "",
        "Make sure your payment is up to date!"
      ].join("\n");

      try {
        if (currentSock) {
          await currentSock.sendMessage(groupJid, { text: msg });
          console.log(`[renewal-reminder] Sent reminder for policy ${policy.id} to ${groupJid}`);
        }
      } catch (e) {
        console.error(`[renewal-reminder] Failed to send to ${groupJid}:`, e.message);
      }
    }
  } catch (e) {
    console.error("[renewal-reminder] Failed to fetch renewals:", e.message);
  }
}, { timezone: "Asia/Singapore" });

// ── Main ────────────────────────────────────────────────────
async function startSock() {
  const { state, saveCreds, deleteSession, flush } =
    await useSupabaseAuthState(BOT_TENANT_ID, supabase);
  deleteCurrentSession = deleteSession;

  process.once("SIGTERM", async () => {
    console.log("[bot] SIGTERM — flushing auth state before exit...");
    await flush();
    process.exit(0);
  });

  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    logger: pino({ level: "warn" }),
    browser: Browsers.macOS("Safari"),
    getMessage: async () => undefined,
  });
  currentSock = sock;

  sock.ev.on("creds.update", saveCreds);

  // If a pairing code was requested, ask WA for one right after socket init
  if (pendingPairingPhone) {
    const phone = pendingPairingPhone;
    pendingPairingPhone = null;
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phone);
        await pushPairingCode(code);
      } catch (e) {
        console.error("[pairing] requestPairingCode failed:", e.message);
      }
    }, 3000);
  }

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("QR code generated — pushing to dashboard...");
      await pushQR(qr);
    }

    if (connection === "open") {
      connectionFailures = 0;
      console.log("WhatsApp connected!");
      const groups = await sock.groupFetchAllParticipating();
      const groupList = Object.values(groups).map(g => ({ id: g.id, name: g.subject }));
      await pushConnected(groupList);

      const knownGroupJids = new Set(Object.keys(groups));
      const allSettings = await fetchAllSettings();
      buildGroupMap(allSettings, knownGroupJids);
      scheduleAllSummaries(sock);

      let lastSettingsStr = JSON.stringify(allSettings);
      setInterval(async () => {
        const latest = await fetchAllSettings();
        const latestStr = JSON.stringify(latest);
        if (latestStr !== lastSettingsStr) {
          console.log("Settings changed — rebuilding group map...");
          const g = await sock.groupFetchAllParticipating();
          buildGroupMap(latest, new Set(Object.keys(g)));
          scheduleAllSummaries(sock);
          lastSettingsStr = latestStr;
        }
      }, 5 * 60 * 1000);

      setInterval(async () => {
        try {
          const res = await axios.get(`${FASTAPI_URL}/internal/messages`, {
            headers: { "X-Internal-Key": INTERNAL_KEY }
          });
          for (const msg of res.data.messages || []) {
            if (msg.group_jid && groupMap.has(msg.group_jid)) {
              await sock.sendMessage(msg.group_jid, { text: msg.text });
              console.log(`Sent queued message to ${msg.group_jid}`);
            }
          }
        } catch { /* silently ignore */ }
      }, 10000);
    }

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`Connection closed, reason: ${reason}`);
      if (reason === DisconnectReason.loggedOut) {
        console.log("Logged out — removing session from DB and restarting");
        await deleteSession();
        process.exit(1);
      } else {
        connectionFailures++;
        console.log(`Connection failure #${connectionFailures}`);
        // After 3 consecutive failures, wipe the session — Baileys will generate a fresh QR
        if (connectionFailures >= 3) {
          console.log("[bot] 3 failed reconnects — clearing stale session for fresh QR...");
          try { await deleteSession(); } catch {}
          connectionFailures = 0;
        }
        setTimeout(startSockWithRetry, 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid;

      const dbgConv    = msg.message?.conversation;
      const dbgExt     = msg.message?.extendedTextMessage?.text;
      const dbgEphConv = msg.message?.ephemeralMessage?.message?.conversation;
      const dbgEphExt  = msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text;
      console.log(`[msg] jid=${remoteJid} fromMe=${msg.key.fromMe} groupMapHas=${groupMap.has(remoteJid)} conv=${dbgConv} ext=${dbgExt} ephConv=${dbgEphConv} ephExt=${dbgEphExt}`);

      const text = (
        msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.ephemeralMessage?.message?.conversation
        || msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text
        || ""
      ).trim().toLowerCase();

      if (groupMap.has(remoteJid) && (text.includes("shopping list") || text.includes("/shopping"))) {
        await handleShoppingListCommand(sock, remoteJid);
        continue;
      }
      if (groupMap.has(remoteJid) && isGapQuery(text)) {
        const { household_id } = groupMap.get(remoteJid);
        await handleGapQuery(sock, remoteJid, household_id);
        continue;
      }
      if (groupMap.has(remoteJid) && isInsuranceQuery(text)) {
        const { household_id } = groupMap.get(remoteJid);
        await handleInsuranceQuery(sock, remoteJid, household_id, text);
        continue;
      }

      if (!groupMap.has(remoteJid)) continue;
      if (!msg.message?.imageMessage &&
          !msg.message?.viewOnceMessage?.message?.imageMessage &&
          !msg.message?.viewOnceMessageV2?.message?.imageMessage) continue;
      await processReceiptImage(msg, sock);
    }
  });

  return sock;
}

// ── QR regeneration / pairing request polling ────────────────
setInterval(async () => {
  try {
    const res = await axios.get(`${FASTAPI_URL}/internal/qr-status`, {
      headers: { "X-Internal-Key": INTERNAL_KEY }
    });
    const { qr_requested, pairing_phone } = res.data;
    if (qr_requested || pairing_phone) {
      if (pairing_phone) {
        console.log(`Pairing code requested for ${pairing_phone} — wiping session and restarting...`);
        pendingPairingPhone = pairing_phone;
      } else {
        console.log("QR regeneration requested — wiping session and restarting...");
      }
      // Always wipe session — use deleteCurrentSession if available, else delete directly
      if (deleteCurrentSession) {
        await deleteCurrentSession();
        deleteCurrentSession = null;
      } else {
        try {
          await supabase.from("whatsapp_sessions").delete().eq("tenant_id", BOT_TENANT_ID);
          console.log("[qr-reset] Session cleared from DB directly");
        } catch (e) {
          console.error("[qr-reset] Direct session delete failed:", e.message);
        }
      }
      connectionFailures = 0;
      if (currentSock) {
        currentSock.end(new Error(pairing_phone ? "Pairing code requested" : "QR reset requested"));
      } else {
        startSockWithRetry();
      }
    }
  } catch { /* silently ignore — backend may not be up yet */ }
}, 5000);

async function startSockWithRetry() {
  try {
    await startSock();
  } catch (e) {
    console.error("[bot] startSock failed:", e.message, "— retrying in 5s");
    setTimeout(startSockWithRetry, 5000);
  }
}

// Re-push last QR every 15s so a backend restart doesn't black out the QR display
setInterval(async () => {
  if (lastQRImageUrl) {
    try {
      await axios.post(`${FASTAPI_URL}/internal/qr`,
        { qr: lastQRImageUrl, connected: false },
        { headers: { "X-Internal-Key": INTERNAL_KEY } }
      );
    } catch { /* silently ignore */ }
  }
}, 15000);

console.log(`[bot] Starting — FASTAPI_URL=${FASTAPI_URL} TENANT=${BOT_TENANT_ID}`);
startSockWithRetry();
