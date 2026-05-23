import "dotenv/config";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WA = require("baileys");
const makeWASocket = WA.default ?? WA;
const {
  DisconnectReason,
  downloadMediaMessage,
  Browsers,
  fetchLatestBaileysVersion,
} = WA;
import { Boom } from "@hapi/boom";
import axios from "axios";
import FormData from "form-data";
import pino from "pino";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { useSupabaseAuthState } from "./db-auth-state.js";

const FASTAPI_URL   = process.env.FASTAPI_URL   || "http://localhost:8000";
const INTERNAL_KEY  = process.env.INTERNAL_KEY  || "homly-internal";
const SERVICE_KEY   = process.env.SUPABASE_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const BOT_TENANT_ID = process.env.BOT_TENANT_ID || "default";

if (!SERVICE_KEY) {
  console.error("[bot] FATAL: SUPABASE_KEY not set");
  process.exit(1);
}
if (!SUPABASE_URL) {
  console.error("[bot] FATAL: SUPABASE_URL not set");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { realtime: { transport: ws } });

const iHeaders = { "X-Internal-Key": INTERNAL_KEY };
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic",
]);

let currentSock = null;
let connectionFailures = 0;
let decryptFailures = 0;

// ── QR / connected ──────────────────────────────────────────
async function pushQR(qrData) {
  try {
    const qrImageUrl = await QRCode.toDataURL(qrData);
    await axios.post(`${FASTAPI_URL}/internal/qr`, { qr: qrImageUrl }, { headers: iHeaders });
  } catch (e) {
    console.error("[bot] pushQR failed:", e.message);
  }
}

async function pushConnected(groups) {
  try {
    await axios.post(
      `${FASTAPI_URL}/internal/connected`,
      { connected: true, groups },
      { headers: iHeaders },
    );
  } catch (e) {
    console.error("[bot] pushConnected failed:", e.message);
  }
}

// ── Outgoing message poll ────────────────────────────────────
function startMessagePoller(sock) {
  setInterval(async () => {
    try {
      const res = await axios.get(`${FASTAPI_URL}/internal/messages`, { headers: iHeaders });
      for (const msg of res.data.messages || []) {
        if (msg.group_jid) {
          await sock.sendMessage(msg.group_jid, { text: msg.text });
        }
      }
    } catch { /* backend may not be up yet */ }
  }, 10000);
}

// ── Text forwarding ──────────────────────────────────────────
async function forwardText(msg) {
  const remoteJid = msg.key.remoteJid;
  const senderJid = msg.key.participant || remoteJid;
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.ephemeralMessage?.message?.conversation ||
    msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
    "";

  if (!text.trim()) return;

  try {
    await axios.post(
      `${FASTAPI_URL}/webhook/whatsapp`,
      {
        typeWebhook: "incomingMessageReceived",
        idMessage: msg.key.id,
        senderData: {
          chatId: remoteJid,
          sender: senderJid,
          senderName: msg.pushName || null,
        },
        messageData: {
          typeMessage: "textMessage",
          textMessageData: { textMessage: text },
        },
      },
      { headers: iHeaders },
    );
  } catch (e) {
    console.error("[bot] forwardText failed:", e.message);
  }
}

// ── Receipt image ────────────────────────────────────────────
async function processReceiptImage(msg, sock) {
  const groupJid = msg.key.remoteJid;
  const msgId    = msg.key.id;
  const imgMsg   =
    msg.message?.imageMessage ||
    msg.message?.viewOnceMessage?.message?.imageMessage ||
    msg.message?.viewOnceMessageV2?.message?.imageMessage ||
    msg.message?.ephemeralMessage?.message?.imageMessage ||
    msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.imageMessage;

  if (!imgMsg) return;

  const mimeType = (imgMsg.mimetype || "image/jpeg").toLowerCase();
  if (!IMAGE_MIME_TYPES.has(mimeType)) return;

  const senderJid   = msg.key.participant || groupJid;
  const senderPhone = senderJid.includes("@") ? senderJid.split("@")[0] : null;
  const pushName    = msg.pushName || null;

  console.log(`[bot] Receipt from ${pushName || senderPhone} in ${groupJid}`);

  try {
    const buffer = await downloadMediaMessage(
      msg, "buffer", {},
      { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage },
    );

    const form = new FormData();
    form.append("file", buffer, { filename: "receipt.jpg", contentType: mimeType });
    form.append("whatsapp_message_id", msgId);
    form.append("group_jid", groupJid);
    if (pushName)    form.append("sender_name",  pushName);
    if (senderPhone) form.append("sender_phone", senderPhone);

    const res = await axios.post(`${FASTAPI_URL}/process-receipt`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${SERVICE_KEY}` },
      timeout: 60000,
    });

    const { status, vendor, total, flagged } = res.data;
    if (status === "duplicate") return;

    if (flagged) {
      await sock.sendMessage(groupJid, {
        text: `Receipt captured but needs a manual check.\nVendor: ${vendor || "unknown"}, Total: ${total ? `SGD ${total}` : "unreadable"}`,
      });
    } else {
      await sock.sendMessage(groupJid, { react: { text: "✅", key: msg.key } });
    }

    console.log(`[bot] Receipt saved — ${vendor || "unknown"}, SGD ${total ?? "?"}`);
  } catch (err) {
    console.error(`[bot] Receipt ${msgId} failed:`, err.response?.data || err.message);
  }
}

// ── Main socket ──────────────────────────────────────────────
async function startSock() {
  const { state, saveCreds, deleteSession, flush } = await useSupabaseAuthState(BOT_TENANT_ID, supabase);
  latestFlush = flush;
  const { version } = await fetchLatestBaileysVersion();
  console.log(`[bot] WA version: ${version.join(".")} | tenant: ${BOT_TENANT_ID}`);

  decryptFailures = 0;

  const botLogger = pino({ level: "warn" });
  const origError = botLogger.error.bind(botLogger);
  botLogger.error = (...args) => {
    const msg = typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]);
    if (msg.includes("decrypt") || msg.includes("init queries")) {
      decryptFailures++;
      if (decryptFailures >= 5) {
        console.warn("[bot] Too many decrypt/init failures — restarting connection");
        decryptFailures = 0;
        setTimeout(() => { if (currentSock) currentSock.end(new Error("decrypt-failure-restart")); }, 500);
      }
    }
    origError(...args);
  };

  const sock = makeWASocket({
    version,
    auth: state,
    logger: botLogger,
    browser: Browsers.ubuntu("Chrome"),
    getMessage: async () => undefined,
  });
  currentSock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("[bot] QR generated — pushing to dashboard");
      await pushQR(qr);
    }

    if (connection === "open") {
      connectionFailures = 0;
      console.log("[bot] Connected!");
      const groups = await sock.groupFetchAllParticipating();
      const groupList = Object.values(groups).map(g => ({ id: g.id, name: g.subject }));
      await pushConnected(groupList);
      startMessagePoller(sock);
    }

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`[bot] Closed, reason: ${reason}`);

      if (reason === DisconnectReason.loggedOut) {
        console.log("[bot] Logged out — clearing session, restart to re-scan QR");
        await deleteSession();
        process.exit(1);
      } else if (reason === 515 || reason === DisconnectReason.restartRequired) {
        setTimeout(startSockWithRetry, 1000);
      } else {
        connectionFailures++;
        if (connectionFailures >= 10) {
          console.log("[bot] 10 failures — exiting for clean restart");
          process.exit(1);
        }
        setTimeout(startSockWithRetry, 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid;
      if (!remoteJid?.endsWith("@g.us")) continue;

      const hasImage =
        msg.message?.imageMessage ||
        msg.message?.viewOnceMessage?.message?.imageMessage ||
        msg.message?.viewOnceMessageV2?.message?.imageMessage ||
        msg.message?.ephemeralMessage?.message?.imageMessage ||
        msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.imageMessage;

      // Skip own text/non-image messages to avoid looping on bot confirmations
      if (msg.key.fromMe && !hasImage) continue;

      if (hasImage) {
        console.log(`[bot] Image received in ${remoteJid} — processing as receipt`);
        await processReceiptImage(msg, sock);
      } else {
        await forwardText(msg);
      }
    }
  });
}

// ── QR-reset polling ─────────────────────────────────────────
setInterval(async () => {
  try {
    const res = await axios.get(`${FASTAPI_URL}/internal/qr-status`, { headers: iHeaders });
    if (res.data?.qr_requested) {
      console.log("[bot] QR reset requested — clearing session and restarting connection");
      if (currentSock) {
        currentSock.end(new Error("QR reset requested"));
      } else {
        startSockWithRetry();
      }
    }
  } catch { /* backend may not be up yet */ }
}, 5000);

async function startSockWithRetry() {
  try {
    await startSock();
  } catch (e) {
    console.error("[bot] startSock failed:", e.message, "— retrying in 5s");
    setTimeout(startSockWithRetry, 5000);
  }
}

// flush is captured per-startSock call; store latest reference for SIGTERM
let latestFlush = null;

process.on("SIGTERM", async () => {
  console.log("[bot] SIGTERM received — flushing auth state");
  try { if (latestFlush) await latestFlush(); } catch { /* ignore */ }
  try { if (currentSock) currentSock.end(); } catch { /* ignore */ }
  process.exit(0);
});

console.log(`[bot] Starting — FASTAPI_URL=${FASTAPI_URL} tenant: ${BOT_TENANT_ID}`);
startSockWithRetry();
