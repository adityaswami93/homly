const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} = require("baileys");
const { Boom } = require("@hapi/boom");
const axios = require("axios");
const FormData = require("form-data");
const cron = require("node-cron");
const pino = require("pino");
const QRCode = require("qrcode");
require("dotenv").config();

const {
  ensureBucket,
  downloadAuthState,
  uploadAuthState,
} = require("./storage-state");

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8000";
const INTERNAL_KEY = process.env.INTERNAL_KEY || "homly-internal";
const SERVICE_KEY = process.env.SUPABASE_KEY;

if (!SERVICE_KEY) {
  console.error("Missing required env var: SUPABASE_KEY");
  process.exit(1);
}

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"
]);

// groupJid → { household_id, settings }
const groupMap = new Map();
// household_id → cron job
const cronJobs = new Map();
// current active socket (set on every startSock call)
let currentSock = null;

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
async function pushQR(qrData) {
  try {
    const qrImageUrl = await QRCode.toDataURL(qrData);
    await axios.post(`${FASTAPI_URL}/internal/qr`,
      { qr: qrImageUrl, connected: false },
      { headers: { "X-Internal-Key": INTERNAL_KEY } }
    );
  } catch (e) {
    console.error("Failed to push QR:", e.message);
  }
}

async function pushConnected(groups) {
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

  let imgMsg =
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
    const receipts       = (data.receipts || []).filter(r => r.reimbursable !== false);
    const category_totals = data.category_totals;
    const total          = data.reimbursable_total ?? data.total;
    const flagged_count  = receipts.filter(r => r.flagged).length;
    const week_number    = data.week_number;
    const year           = data.year;
    const date_from      = data.date_from;
    const date_to        = data.date_to;

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
      await sock.sendMessage(jid, {
        text: "No items on your shopping list and nothing looks low on stock yet."
      });
      return;
    }

    await sock.sendMessage(jid, { text: lines.join("\n") });
  } catch (e) {
    console.error("Shopping list command failed:", e.message);
  }
}

// ── Main ────────────────────────────────────────────────────
async function startSock() {
  // Restore auth state from Supabase Storage before starting
  await ensureBucket();
  await downloadAuthState();

  const { state, saveCreds } = await useMultiFileAuthState("auth_state");

  const sock = makeWASocket({
    printQRInTerminal: false,
    version: [2, 3000, 1033893291],
    auth: state,
    logger: pino({ level: "warn" }),
    browser: ["Homly", "Chrome", "1.0.0"],
  });
  currentSock = sock;

  sock.ev.on("creds.update", async () => {
    saveCreds();
    setTimeout(async () => {
      await uploadAuthState();
    }, 2000);
  });

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("QR code generated — pushing to dashboard...");
      await pushQR(qr);
    }

    if (connection === "open") {
      console.log("WhatsApp connected!");

      const groups = await sock.groupFetchAllParticipating();
      const groupList = Object.values(groups).map(g => ({ jid: g.id, name: g.subject }));
      await pushConnected(groupList);

      // Build group → household map from DB settings
      const knownGroupJids = new Set(Object.keys(groups));
      const allSettings = await fetchAllSettings();
      buildGroupMap(allSettings, knownGroupJids);
      scheduleAllSummaries(sock);

      // Re-sync map every 5 min in case settings changed (new group assigned, etc.)
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

      // Poll message queue every 10 seconds
      setInterval(async () => {
        try {
          const res = await axios.get(`${FASTAPI_URL}/internal/messages`, {
            headers: { "X-Internal-Key": INTERNAL_KEY }
          });
          const { messages } = res.data;
          for (const msg of messages) {
            if (msg.group_jid && groupMap.has(msg.group_jid)) {
              await sock.sendMessage(msg.group_jid, { text: msg.text });
              console.log(`Sent queued message to ${msg.group_jid}`);
            }
          }
        } catch (e) {
          // silently ignore
        }
      }, 10000);
    }

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`Connection closed, reason: ${reason}`);
      if (reason === DisconnectReason.loggedOut) {
        console.log("Logged out — delete auth_state and restart");
        process.exit(1);
      } else {
        setTimeout(startSock, 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid;

      // Debug logging — helps diagnose command routing
      const dbgConv    = msg.message?.conversation;
      const dbgExt     = msg.message?.extendedTextMessage?.text;
      const dbgEphConv = msg.message?.ephemeralMessage?.message?.conversation;
      const dbgEphExt  = msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text;
      console.log(`[msg] jid=${remoteJid} fromMe=${msg.key.fromMe} groupMapHas=${groupMap.has(remoteJid)} conv=${dbgConv} ext=${dbgExt} ephConv=${dbgEphConv} ephExt=${dbgEphExt}`);

      // Extract text from all possible wrappers
      const text = (
        msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.ephemeralMessage?.message?.conversation
        || msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text
        || ""
      ).trim().toLowerCase();

      // Shopping list command — works from ANY mapped group, not filtered by groupJid
      if (groupMap.has(remoteJid) && (text.includes("shopping list") || text.includes("/shopping"))) {
        await handleShoppingListCommand(sock, remoteJid);
        continue;
      }

      // Insurance query command
      if (groupMap.has(remoteJid) && isInsuranceQuery(text)) {
        const { household_id } = groupMap.get(remoteJid);
        await handleInsuranceQuery(sock, remoteJid, household_id, text);
        continue;
      }

      // Receipt image handling — must be a mapped group
      if (!groupMap.has(remoteJid)) continue;
      if (!msg.message?.imageMessage &&
          !msg.message?.viewOnceMessage?.message?.imageMessage &&
          !msg.message?.viewOnceMessageV2?.message?.imageMessage) continue;
      await processReceiptImage(msg, sock);
    }
  });

  return sock;
}

// ── Insurance query handler ──────────────────────────────────
const INSURANCE_KEYWORDS = [
  "insurance", "policy", "policies", "health insurance", "life insurance",
  "car insurance", "home insurance", "travel insurance"
];

function isInsuranceQuery(text) {
  return INSURANCE_KEYWORDS.some((kw) => text.includes(kw));
}

function detectCoverageTypeFilter(text) {
  const types = ["health", "life", "home", "car", "travel"];
  return types.find((t) => text.includes(t)) || null;
}

async function handleInsuranceQuery(sock, jid, householdId, text) {
  try {
    const res = await axios.get(`${FASTAPI_URL}/insurance`, {
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      params: { household_id: householdId }
    });
    const all = res.data || [];
    const typeFilter = detectCoverageTypeFilter(text);
    const policies = typeFilter ? all.filter((p) => p.coverage_type === typeFilter) : all;

    if (policies.length === 0) {
      await sock.sendMessage(jid, {
        text: "No insurance policies added yet. Visit the Homly dashboard to add your policies."
      });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Group by coverage type
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
        const premium = p.premium_amount
          ? `$${Number(p.premium_amount).toFixed(0)}/${p.premium_frequency ?? "mo"}`
          : "—";
        lines.push(`  Coverage: ${coverage} | Premium: ${premium}`);
        if (p.renewal_date) {
          const renewal = new Date(p.renewal_date);
          const days = Math.ceil((renewal.getTime() - today.getTime()) / 86400000);
          const dateStr = renewal.toLocaleDateString("en-SG", {
            day: "numeric", month: "short", year: "numeric"
          });
          lines.push(`  Renews: ${dateStr} (${days > 0 ? `${days} days` : "overdue"})`);
        }
      }
      lines.push("");
    }

    if (!typeFilter) {
      lines.push('Reply with a type to filter, e.g. "health insurance"');
    }

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

    // Send reminder to each household's group
    for (const policy of renewals) {
      const entry = [...groupMap.values()].find(
        (e) => e.household_id === policy.household_id
      );
      if (!entry || !entry.settings?.group_jid) continue;

      const groupJid = entry.settings.group_jid;
      const days = policy.days_until_renewal;
      const renewalDate = policy.renewal_date
        ? new Date(policy.renewal_date).toLocaleDateString("en-SG", {
            day: "numeric", month: "short", year: "numeric"
          })
        : "—";
      const premium = policy.premium_amount
        ? `$${Number(policy.premium_amount).toFixed(2)} / ${policy.premium_frequency ?? "period"}`
        : "—";

      const msg = [
        "🔔 *Insurance Renewal Reminder*",
        "",
        `Your *${policy.coverage_type}* insurance with *${policy.provider}* renews in *${days} days* (${renewalDate}).`,
        "",
        `Policy #: ${policy.policy_number || "—"}`,
        `Premium: ${premium}`,
        "",
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

// ── QR regeneration request polling ─────────────────────────
// Runs independently of connection state so the button always works
setInterval(async () => {
  try {
    const res = await axios.get(`${FASTAPI_URL}/internal/qr-status`, {
      headers: { "X-Internal-Key": INTERNAL_KEY }
    });
    if (res.data.qr_requested && currentSock) {
      console.log("QR regeneration requested — restarting connection...");
      currentSock.end(new Error("QR reset requested by user"));
    }
  } catch (e) {
    // silently ignore — backend may not be up yet
  }
}, 5000);

console.log("Homly WhatsApp listener starting...");
startSock().catch(console.error);
