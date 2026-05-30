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
const PDF_MIME_TYPES = new Set(["application/pdf"]);

let currentSock = null;
let connectionFailures = 0;
let decryptFailures = 0;
let isConnected = false;
let connectedGroups = [];

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
let _messagePollerStarted = false;

function startMessagePoller() {
  if (_messagePollerStarted) return;
  _messagePollerStarted = true;

  setInterval(async () => {
    if (!currentSock || !isConnected) return;
    let messages = [];
    try {
      const res = await axios.get(`${FASTAPI_URL}/internal/messages`, { headers: iHeaders });
      messages = res.data.messages || [];
    } catch { /* backend may not be up yet */ return; }

    for (const msg of messages) {
      if (!msg.group_jid) continue;
      try {
        await currentSock.sendMessage(msg.group_jid, { text: msg.text });
      } catch (e) {
        console.error("[bot] sendMessage failed:", e.message);
      }
    }
  }, 5000);
}

// ── Household query engine ───────────────────────────────────
function isHouseholdQuery(text) {
  const t = (text || "").trim();
  if (!t || t.length < 5 || t.length > 400) return false;
  if (t.endsWith("?")) return true;
  return /^(what|how|when|where|who|which|show|tell|list|find|give|total|summarize|summarise|compare|any|are|is|do|did|have|has)\b/i.test(t);
}

async function handleHouseholdQuery(text, groupJid, sock) {
  try {
    await sock.sendPresenceUpdate("composing", groupJid);
    const res = await axios.post(
      `${FASTAPI_URL}/query`,
      { query: text, group_jid: groupJid },
      { headers: { Authorization: `Bearer ${SERVICE_KEY}` }, timeout: 30000 },
    );
    await sock.sendPresenceUpdate("paused", groupJid);
    if (res.data?.handled) {
      await sock.sendMessage(groupJid, { text: res.data.response });
      return true;
    }
    return false;
  } catch (e) {
    console.error("[bot] query failed:", e.message);
    await sock.sendPresenceUpdate("paused", groupJid);
    return false;
  }
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

// ── Recipe image ────────────────────────────────────────────
const RECIPE_TRIGGERS = /^(🛒|cook|recipe|ingredients|what do i need)/i;

function isRecipeCaption(caption) {
  return RECIPE_TRIGGERS.test((caption || "").trim());
}

async function processRecipeImage(msg, sock) {
  const groupJid = msg.key.remoteJid;
  const imgMsg   =
    msg.message?.imageMessage ||
    msg.message?.viewOnceMessage?.message?.imageMessage ||
    msg.message?.viewOnceMessageV2?.message?.imageMessage ||
    msg.message?.ephemeralMessage?.message?.imageMessage ||
    msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.imageMessage;

  if (!imgMsg) return;

  const mimeType    = (imgMsg.mimetype || "image/jpeg").toLowerCase();
  const senderJid   = msg.key.participant || groupJid;
  const senderPhone = senderJid.includes("@") ? senderJid.split("@")[0] : null;
  const pushName    = msg.pushName || null;

  console.log(`[bot] Recipe scan from ${pushName || senderPhone} in ${groupJid}`);

  try {
    const buffer = await downloadMediaMessage(
      msg, "buffer", {},
      { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage },
    );

    const form = new FormData();
    form.append("file", buffer, { filename: "food.jpg", contentType: mimeType });
    form.append("group_jid", groupJid);
    if (pushName)    form.append("sender_name",  pushName);
    if (senderPhone) form.append("sender_phone", senderPhone);

    const res = await axios.post(`${FASTAPI_URL}/recipe/scan`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${SERVICE_KEY}` },
      timeout: 60000,
    });

    const { dish, confidence, ingredients, notes } = res.data;

    if (!ingredients || ingredients.length === 0) {
      await sock.sendMessage(groupJid, {
        text: "Could not identify a dish in this photo. Try a clearer image, or add a caption like \"recipe 🛒\".",
      });
      return;
    }

    const nonStaples = ingredients.filter(i => !i.pantry_staple);
    const staples    = ingredients.filter(i =>  i.pantry_staple);

    const formatQty = (i) => {
      const q = i.qty != null ? i.qty : "";
      const u = i.unit ? ` ${i.unit}` : "";
      return q ? `(${q}${u})` : "";
    };

    const itemLines = nonStaples.map(i => `- ${i.name} ${formatQty(i)}`.trimEnd()).join("\n");
    const stapleNames = staples.map(i => i.name).join(", ");

    let reply = "";
    if (confidence === "low") {
      reply += "⚠️ _Not sure about this dish — here's my best guess:_\n\n";
    }
    reply += `🍽️ *${dish || "Unknown dish"}*\n\n`;
    reply += `🛒 *Shopping list:*\n${itemLines}`;
    if (stapleNames) {
      reply += `\n\n✅ Skipped pantry staples (${stapleNames})`;
    }
    reply += "\n\n_Added to your Homly shopping list_";

    await sock.sendMessage(groupJid, { text: reply });
    console.log(`[bot] Recipe scan done — ${dish || "unknown"}, ${nonStaples.length} items added`);
  } catch (err) {
    console.error(`[bot] Recipe scan failed:`, err.response?.data || err.message);
    await sock.sendMessage(groupJid, {
      text: "Could not analyse this recipe — please try again.",
    });
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
    await sock.sendMessage(groupJid, {
      text: "Could not process the receipt — please try a clearer photo.",
    });
  }
}

// ── Receipt PDF document ─────────────────────────────────────
async function processReceiptDocument(msg, sock) {
  const groupJid = msg.key.remoteJid;
  const msgId    = msg.key.id;
  const docMsg   =
    msg.message?.documentMessage ||
    msg.message?.ephemeralMessage?.message?.documentMessage;

  if (!docMsg) return;

  const mimeType = (docMsg.mimetype || "").toLowerCase();
  if (!PDF_MIME_TYPES.has(mimeType)) return;

  const senderJid   = msg.key.participant || groupJid;
  const senderPhone = senderJid.includes("@") ? senderJid.split("@")[0] : null;
  const pushName    = msg.pushName || null;

  console.log(`[bot] PDF receipt from ${pushName || senderPhone} in ${groupJid}`);

  try {
    const buffer = await downloadMediaMessage(
      msg, "buffer", {},
      { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage },
    );

    const form = new FormData();
    form.append("file", buffer, { filename: "receipt.pdf", contentType: "application/pdf" });
    form.append("whatsapp_message_id", msgId);
    form.append("group_jid", groupJid);
    if (pushName)    form.append("sender_name",  pushName);
    if (senderPhone) form.append("sender_phone", senderPhone);

    const res = await axios.post(`${FASTAPI_URL}/process-receipt`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${SERVICE_KEY}` },
      timeout: 90000,  // PDF conversion + OCR may take longer
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

    console.log(`[bot] PDF Receipt saved — ${vendor || "unknown"}, SGD ${total ?? "?"}`);
  } catch (err) {
    console.error(`[bot] PDF Receipt ${msgId} failed:`, err.response?.data || err.message);
    await sock.sendMessage(groupJid, {
      text: "Could not process the PDF receipt — please try a clearer image or check the file.",
    });
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
      connectedGroups = Object.values(groups).map(g => ({ id: g.id, name: g.subject }));
      isConnected = true;
      await pushConnected(connectedGroups);
      startMessagePoller();
    }

    if (connection === "close") {
      isConnected = false;
      connectedGroups = [];
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

      const docMsg =
        msg.message?.documentMessage ||
        msg.message?.ephemeralMessage?.message?.documentMessage;
      const hasPDF = docMsg &&
        PDF_MIME_TYPES.has((docMsg.mimetype || "").toLowerCase());

      // Skip own text/non-media messages to avoid looping on bot confirmations
      if (msg.key.fromMe && !hasImage && !hasPDF) continue;

      if (hasImage) {
        const imgCaption = hasImage?.caption || "";
        if (isRecipeCaption(imgCaption)) {
          console.log(`[bot] Recipe trigger detected in ${remoteJid} — processing as recipe`);
          await processRecipeImage(msg, sock);
        } else {
          console.log(`[bot] Image received in ${remoteJid} — processing as receipt`);
          await processReceiptImage(msg, sock);
        }
      } else if (hasPDF) {
        console.log(`[bot] PDF document received in ${remoteJid} — processing as receipt`);
        await processReceiptDocument(msg, sock);
      } else {
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.ephemeralMessage?.message?.conversation ||
          msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
          "";
        if (isHouseholdQuery(text)) {
          console.log(`[bot] Query detected in ${remoteJid}: "${text.slice(0, 60)}"`);
          const handled = await handleHouseholdQuery(text, remoteJid, sock);
          if (!handled) await forwardText(msg);
        } else {
          await forwardText(msg);
        }
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
    // Re-sync connected state if backend restarted and lost it
    if (isConnected && res.data?.connected === false) {
      console.log("[bot] Backend lost connected state — re-syncing");
      await pushConnected(connectedGroups);
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
