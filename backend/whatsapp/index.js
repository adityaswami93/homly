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
const qrcode = require("qrcode-terminal");
require("dotenv").config();

const FASTAPI_URL   = process.env.FASTAPI_URL  || "http://localhost:8000";
const GROUP_NAME    = process.env.GROUP_NAME;
const HOMLY_USER_ID = process.env.HOMLY_USER_ID;
let   HOMLY_TOKEN   = process.env.HOMLY_TOKEN;

if (!GROUP_NAME || !HOMLY_USER_ID || !HOMLY_TOKEN) {
  console.error("Missing required env vars: GROUP_NAME, HOMLY_USER_ID, HOMLY_TOKEN");
  process.exit(1);
}

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"
]);

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
        text: `Receipt captured but needs a manual check (image unclear).\nVendor: ${vendor || "unknown"}, Total: ${total ? `SGD ${total}` : "unreadable"}`,
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

async function findGroupJid(sock) {
  const groups = await sock.groupFetchAllParticipating();
  for (const [jid, meta] of Object.entries(groups)) {
    if (meta.subject === GROUP_NAME) {
      console.log(`Found group: "${GROUP_NAME}" → ${jid}`);
      return jid;
    }
  }
  console.warn(`Group "${GROUP_NAME}" not found. Check GROUP_NAME env var.`);
  return null;
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
    qrcode.generate(qr, { small: true });
  }
  /*
  if (connection === "close") {
    // Log the full error object
    console.log("Full error:", JSON.stringify(lastDisconnect?.error, null, 2));
    const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
    console.log(`Connection closed, reason: ${reason}`);
    setTimeout(startSock, 3000);
  }
  */
    if (connection === "open") {
      console.log("WhatsApp connected!");
      groupJid = await findGroupJid(sock);

      // Friday 6pm SGT = Friday 10:00 UTC
      cron.schedule("0 10 * * 5", async () => {
        if (groupJid) await sendWeeklySummary(sock, groupJid);
      }, { timezone: "UTC" });

      // Refresh JWT every 45 min so it never expires
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

      console.log("Weekly summary scheduled: Fridays 6pm SGT");
    }
    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`Connection closed, reason: ${reason}`);
      
      if (reason === DisconnectReason.loggedOut) {
        console.log("Logged out — delete auth_state folder and restart");
        process.exit(1);
      } else {
        // For ALL other reasons including 405, retry
        console.log("Reconnecting in 3 seconds...");
        setTimeout(startSock, 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // Add these debug lines at the top:
    console.log("Message received, type:", type);
    console.log("Message keys:", messages.map(m => ({
      jid: m.key.remoteJid,
      fromMe: m.key.fromMe,
      messageType: Object.keys(m.message || {}).join(", ")
    })));
    
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!groupJid || msg.key.remoteJid !== groupJid) continue;
      //if (msg.key.fromMe) continue;
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
