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

    const { receipts, category_totals, total, flagged_count, date_from, date_to, week_number, year } = res.data;

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

// ── Main ────────────────────────────────────────────────────
async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_state");

  const sock = makeWASocket({
    printQRInTerminal: false,
    version: [2, 3000, 1033893291],
    auth: state,
    logger: pino({ level: "warn" }),
    browser: ["Homly", "Chrome", "1.0.0"],
  });
  currentSock = sock;

  sock.ev.on("creds.update", saveCreds);

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
      if (!groupMap.has(msg.key.remoteJid)) continue;
      if (!msg.message?.imageMessage &&
          !msg.message?.viewOnceMessage?.message?.imageMessage &&
          !msg.message?.viewOnceMessageV2?.message?.imageMessage) continue;
      await processReceiptImage(msg, sock);
    }
  });

  return sock;
}

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
