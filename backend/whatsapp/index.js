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
const fs = require("fs");
require("dotenv").config();

const FASTAPI_URL   = process.env.FASTAPI_URL  || "http://localhost:8000";
const HOMLY_USER_ID = process.env.HOMLY_USER_ID;
const INTERNAL_KEY  = process.env.INTERNAL_KEY || "homly-internal";
let   HOMLY_TOKEN   = process.env.HOMLY_TOKEN;
let   GROUP_NAME    = process.env.GROUP_NAME || null;

if (!HOMLY_USER_ID || !HOMLY_TOKEN) {
  console.error("Missing required env vars: HOMLY_USER_ID, HOMLY_TOKEN");
  process.exit(1);
}

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"
]);

// ── Settings ────────────────────────────────────────────────
let currentCronJob = null;

async function fetchSettings() {
  try {
    const res = await axios.get(`${FASTAPI_URL}/internal/settings`, {
      headers: { "X-Internal-Key": INTERNAL_KEY }
    });
    return res.data;
  } catch (e) {
    console.error("Failed to fetch settings:", e.message);
    return {
      summary_day: 6,
      summary_hour: 9,
      summary_timezone: "Asia/Singapore",
      cutoff_mode: "last7days",
      group_name: GROUP_NAME,
    };
  }
}

// day: 0=Monday..6=Sunday → cron day: 1=Monday..7=Sunday (or 0=Sunday)
function daytoCron(day) {
  // Our day: 0=Mon,1=Tue,2=Wed,3=Thu,4=Fri,5=Sat,6=Sun
  // Cron day: 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  const map = [1, 2, 3, 4, 5, 6, 0];
  return map[day];
}

function scheduleSummary(sock, getGroupJid, settings) {
  if (currentCronJob) {
    currentCronJob.stop();
    currentCronJob = null;
  }

  const { summary_day, summary_hour, summary_timezone, cutoff_mode } = settings;
  const cronDay = daytoCron(summary_day);
  const cronExpr = `0 ${summary_hour} * * ${cronDay}`;

  console.log(`Scheduling summary: cron="${cronExpr}" tz="${summary_timezone}" mode="${cutoff_mode}"`);

  currentCronJob = cron.schedule(cronExpr, async () => {
    const groupJid = getGroupJid();
    if (groupJid) {
      // Re-fetch settings in case they changed
      const latest = await fetchSettings();
      await sendWeeklySummary(sock, groupJid, latest.cutoff_mode);
    }
  }, { timezone: summary_timezone });
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

function getGroupNameFromFile() {
  try {
    if (fs.existsSync("/tmp/homly_group.txt")) {
      const name = fs.readFileSync("/tmp/homly_group.txt", "utf8").trim();
      if (name) return name;
    }
  } catch (e) {}
  return GROUP_NAME;
}

// ── Receipt processing ──────────────────────────────────────
async function processReceiptImage(msg, sock) {
  const msgId   = msg.key.id;
  const msgInfo = msg.message;

  let imgMsg =
    msgInfo.imageMessage ||
    msgInfo.viewOnceMessage?.message?.imageMessage ||
    msgInfo.viewOnceMessageV2?.message?.imageMessage;

  if (!imgMsg) return;

  const mimeType = imgMsg.mimetype || "image/jpeg";
  if (!IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) return;

  console.log(`Receipt detected — message ID: ${msgId}`);

  try {
    const buffer = await downloadMediaMessage(
      msg, "buffer", {},
      { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
    );

    const form = new FormData();
    form.append("file", buffer, { filename: "receipt.jpg", contentType: mimeType });
    form.append("whatsapp_message_id", msgId);
    form.append("user_id", HOMLY_USER_ID);

    const res = await axios.post(`${FASTAPI_URL}/process-receipt`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${HOMLY_TOKEN}` },
      timeout: 60000,
    });

    const { vendor, total, confidence, flagged } = res.data;

    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: "✅", key: msg.key },
    });

    if (flagged) {
      await sock.sendMessage(msg.key.remoteJid, {
        text: `Receipt captured but needs a manual check.\nVendor: ${vendor || "unknown"}, Total: ${total ? `SGD ${total}` : "unreadable"}`,
      });
    }

    console.log(`Receipt saved — ${vendor || "unknown"}, SGD ${total ?? "?"}, confidence: ${confidence}`);
  } catch (err) {
    console.error(`Failed to process receipt ${msgId}:`, err.response?.data || err.message);
  }
}

// ── Weekly summary ──────────────────────────────────────────
async function sendWeeklySummary(sock, groupJid, cutoffMode = "last7days") {
  console.log(`Sending summary (mode: ${cutoffMode})...`);
  try {
    const endpoint = cutoffMode === "last7days" ? "/summary/last7days" : "/this-week";
    const res = await axios.get(`${FASTAPI_URL}${endpoint}`, {
      headers: { Authorization: `Bearer ${HOMLY_TOKEN}` },
    });

    const { receipts, category_totals, total, flagged_count, week_number, year, date_from, date_to } = res.data;

    if (!receipts || receipts.length === 0) {
      await sock.sendMessage(groupJid, { text: "No receipts recorded in this period." });
      return;
    }

    const receiptLines = receipts.map((r) => {
      const d = r.date
        ? new Date(r.date).toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" })
        : "Unknown date";
      const amt = r.total != null ? `SGD ${Number(r.total).toFixed(2)}` : "amount unclear";
      return `${d}  ${r.vendor || "Unknown vendor"}\n  ${amt}${r.flagged ? " ⚠️" : " ✓"}`;
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
    console.log("Summary sent");
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

  let groupJid = null;
  const getGroupJid = () => groupJid;

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

      // Load settings and find group
      const settings = await fetchSettings();
      const targetName = settings.group_name || getGroupNameFromFile();

      for (const [jid, meta] of Object.entries(groups)) {
        if (meta.subject === targetName) {
          groupJid = jid;
          console.log(`Found group: "${targetName}" → ${jid}`);
          break;
        }
      }

      if (!groupJid) {
        console.warn(`Group not found. Set it via the setup page.`);
        const interval = setInterval(async () => {
          const s = await fetchSettings();
          const name = s.group_name || getGroupNameFromFile();
          const g = await sock.groupFetchAllParticipating();
          for (const [jid, meta] of Object.entries(g)) {
            if (meta.subject === name) {
              groupJid = jid;
              console.log(`Group set: "${name}" → ${jid}`);
              clearInterval(interval);
              break;
            }
          }
        }, 10000);
      }

      // Schedule summary based on settings
      scheduleSummary(sock, getGroupJid, settings);

      // Poll settings every 5 min and reschedule if changed
      let lastSettings = JSON.stringify(settings);
      setInterval(async () => {
        const latest = await fetchSettings();
        const latestStr = JSON.stringify(latest);
        if (latestStr !== lastSettings) {
          console.log("Settings changed — rescheduling summary...");
          scheduleSummary(sock, getGroupJid, latest);
          lastSettings = latestStr;

          // Update group if changed
          const name = latest.group_name || getGroupNameFromFile();
          const g = await sock.groupFetchAllParticipating();
          for (const [jid, meta] of Object.entries(g)) {
            if (meta.subject === name) {
              groupJid = jid;
              break;
            }
          }
        }
      }, 5 * 60 * 1000);

      // JWT refresh every 45 min
      setInterval(async () => {
        try {
          const { createClient } = require("@supabase/supabase-js");
          const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
          const { data } = await sb.auth.refreshSession({ refresh_token: process.env.SUPABASE_REFRESH_TOKEN });
          if (data?.session) {
            HOMLY_TOKEN = data.session.access_token;
            console.log("JWT refreshed");
          }
        } catch (e) {
          console.error("JWT refresh failed:", e.message);
        }
      }, 45 * 60 * 1000);
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
      if (!groupJid || msg.key.remoteJid !== groupJid) continue;
      if (!msg.message?.imageMessage &&
          !msg.message?.viewOnceMessage?.message?.imageMessage &&
          !msg.message?.viewOnceMessageV2?.message?.imageMessage) continue;
      await processReceiptImage(msg, sock);
    }
  });

  return sock;
}

console.log("Homly WhatsApp listener starting...");
startSock().catch(console.error);
