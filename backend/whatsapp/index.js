const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  Browsers,
} = require("baileys");
const { Boom } = require("@hapi/boom");
const axios = require("axios");
const FormData = require("form-data");
const cron = require("node-cron");
const pino = require("pino");
const QRCode = require("qrcode");
const fs = require("fs");
require("dotenv").config();

const FASTAPI_URL   = process.env.FASTAPI_URL || "http://localhost:8000";
const HOMLY_USER_ID = process.env.HOMLY_USER_ID;
const HOMLY_TOKEN   = process.env.SUPABASE_SERVICE_KEY;
let   GROUP_NAME    = process.env.GROUP_NAME;

// To this:
if (!HOMLY_USER_ID || !HOMLY_TOKEN) {
  console.error("Missing required env vars: HOMLY_USER_ID, HOMLY_TOKEN");
  process.exit(1);
}

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"
]);

// Push QR to FastAPI state
async function pushQR(qrData) {
  try {
    const qrImageUrl = await QRCode.toDataURL(qrData);
    await axios.post(`${FASTAPI_URL}/internal/qr`,
      { qr: qrImageUrl, connected: false },
      { headers: { "X-Internal-Key": process.env.INTERNAL_KEY || "homly-internal" } }
    );
  } catch (e) {
    console.error("Failed to push QR:", e.message);
  }
}

// Push connected state to FastAPI
async function pushConnected(groups) {
  try {
    await axios.post(`${FASTAPI_URL}/internal/connected`,
      { connected: true, groups: groups },
      { headers: { "X-Internal-Key": process.env.INTERNAL_KEY || "homly-internal" } }
    );
  } catch (e) {
    console.error("Failed to push connected state:", e.message);
  }
}

// Check if group name was updated via API
function getGroupName() {
  try {
    if (fs.existsSync("/tmp/homly_group.txt")) {
      const name = fs.readFileSync("/tmp/homly_group.txt", "utf8").trim();
      if (name) return name;
    }
  } catch (e) {}
  return GROUP_NAME;
}

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

async function sendWeeklySummary(sock, groupJid) {
  console.log("Sending weekly summary...");
  try {
    const res = await axios.get(`${FASTAPI_URL}/this-week`, {
      headers: { Authorization: `Bearer ${HOMLY_TOKEN}` },
    });

    const { receipts, category_totals, total, flagged_count, week_number, year } = res.data;

    if (!receipts || receipts.length === 0) {
      await sock.sendMessage(groupJid, { text: "No receipts recorded this week." });
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

    const message = [
      `📋 *Weekly Expenses Summary*`,
      `Week ${week_number}, ${year}`,
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
    console.log("Weekly summary sent");
  } catch (err) {
    console.error("Failed to send weekly summary:", err.response?.data || err.message);
  }
}

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

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("QR code generated — pushing to dashboard...");
      await pushQR(qr);
    }

    if (connection === "open") {
      console.log("WhatsApp connected!");

      // Fetch all groups and push to API
      const groups = await sock.groupFetchAllParticipating();
      const groupList = Object.values(groups).map(g => ({ jid: g.id, name: g.subject }));
      await pushConnected(groupList);

      // Find target group
      const targetName = getGroupName();
      for (const [jid, meta] of Object.entries(groups)) {
        if (meta.subject === targetName) {
          groupJid = jid;
          console.log(`Found group: "${targetName}" → ${jid}`);
          break;
        }
      }

      if (!groupJid) {
        console.warn(`Group "${targetName}" not found. Set it via the setup page.`);
        // Poll for group name update every 10 seconds
        const interval = setInterval(async () => {
          const name = getGroupName();
          const groups = await sock.groupFetchAllParticipating();
          for (const [jid, meta] of Object.entries(groups)) {
            if (meta.subject === name) {
              groupJid = jid;
              console.log(`Group set: "${name}" → ${jid}`);
              clearInterval(interval);
              break;
            }
          }
        }, 10000);
      }

      // Friday 6pm SGT = Friday 10:00 UTC
      cron.schedule("0 10 * * 5", async () => {
        if (groupJid) await sendWeeklySummary(sock, groupJid);
      }, { timezone: "UTC" });

    }

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`Connection closed, reason: ${reason}`);
      if (reason === DisconnectReason.loggedOut) {
        console.log("Logged out — delete auth_state folder and restart");
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
