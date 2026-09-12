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
import { useSupabaseAuthState } from "./db-auth-state.js";

const FASTAPI_URL   = process.env.FASTAPI_URL   || "http://localhost:8000";
const INTERNAL_KEY  = process.env.INTERNAL_KEY;
const BOT_TENANT_ID = process.env.BOT_TENANT_ID || "default";

// This process no longer holds SUPABASE_KEY. It used to create a service-role
// Supabase client for exactly three things — reading every household's
// `settings` row, inserting a `reminders` row, and persisting its Baileys
// session — and that key bypasses RLS on every table in the project. All
// three now go through /internal/* on the backend, authenticated with
// INTERNAL_KEY. Don't reintroduce a database client here: add an /internal/*
// endpoint instead, so the blast radius of this process staying compromised
// is the endpoints it can call rather than the whole database.
if (!INTERNAL_KEY) {
  console.error("[bot] FATAL: INTERNAL_KEY not set");
  process.exit(1);
}

const iHeaders = { "X-Internal-Key": INTERNAL_KEY };

// Shared client for backend calls, so the internal key is attached in one
// place rather than passed to each call site (and to db-auth-state.js).
const api = axios.create({ baseURL: FASTAPI_URL, headers: iHeaders, timeout: 15000 });
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic",
]);
const PDF_MIME_TYPES = new Set(["application/pdf"]);

let currentSock = null;
let connectionFailures = 0;
let decryptFailures = 0;
let isConnected = false;
let connectedGroups = [];

// ── Group → household mapping ────────────────────────────────
// Maps group_jid to household_id; populated on connect and refreshed every 5 min.
const groupMap = new Map();

async function refreshGroupMap() {
  try {
    const { data } = await api.get("/internal/settings");
    groupMap.clear();
    for (const row of data || []) {
      if (row.group_jid) groupMap.set(row.group_jid, row.household_id);
    }
    console.log(`[bot] groupMap refreshed — ${groupMap.size} household(s)`);
  } catch (e) {
    console.error("[bot] refreshGroupMap failed:", e.message);
  }
}

setInterval(refreshGroupMap, 5 * 60 * 1000);

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

// ── Custom commands cache ────────────────────────────────────
// { household_id: { trigger: response } }
let customCommandsCache = {};

async function refreshCustomCommands() {
  try {
    const res = await axios.get(`${FASTAPI_URL}/internal/commands`, { headers: iHeaders });
    customCommandsCache = res.data?.commands || {};
    const total = Object.values(customCommandsCache).reduce((s, m) => s + Object.keys(m).length, 0);
    console.log(`[bot] customCommands refreshed — ${total} command(s) across ${Object.keys(customCommandsCache).length} household(s)`);
  } catch (e) {
    console.error("[bot] refreshCustomCommands failed:", e.message);
  }
}

// Refresh on start and every 2 minutes
setInterval(refreshCustomCommands, 2 * 60 * 1000);

async function handleCustomCommand(text, household_id, remoteJid, sock) {
  if (!text.startsWith("/")) return false;
  const trigger = text.slice(1).split(/\s+/)[0].toLowerCase().trim();
  if (!trigger) return false;
  const response = customCommandsCache[household_id]?.[trigger];
  if (!response) return false;
  await sock.sendMessage(remoteJid, { text: response });
  return true;
}

// ── Help / capabilities ──────────────────────────────────────
// Exact phrasings only (like the reminder/custom-command handlers below) —
// deterministic and reliable, rather than leaving "what can you do" to the
// LLM to notice and answer well on its own.
const HELP_RE = /^\/?help$|^what (can|do) you (do|help with)\??$/i;

async function handleHelpCommand(text, remoteJid, sock) {
  if (!HELP_RE.test(text.trim())) return false;
  try {
    const res = await axios.get(`${FASTAPI_URL}/internal/help`, { headers: iHeaders });
    await sock.sendMessage(remoteJid, { text: res.data?.text || "Sorry, I couldn't load that right now." });
  } catch (e) {
    console.error("[bot] handleHelpCommand failed:", e.message);
    await sock.sendMessage(remoteJid, { text: "Sorry, I couldn't load that right now." });
  }
  return true;
}

// A household member @-mentioning the bot leaves a literal "@<phone> " (or
// "@<name> ") prefix in the message text, which broke every prefix-based
// match below (custom commands, /remind, and classify_node's text_query
// detection in homly_graph.py all check how the string *starts*). Strip any
// leading mention tokens before those checks run.
function stripLeadingMentions(text) {
  return text.replace(/^(@\S+\s*)+/, "").trim();
}

// Stripping the mention above throws away a fact the backend can't recover:
// that this message was aimed at the bot. The household's engagement mode
// (settings.bot_engagement_mode) decides whether an un-addressed message gets
// a reply at all, so both signals below are forwarded to /internal/graph-invoke
// alongside the cleaned text. Detecting the bot's *name* is left to the backend
// — the name is per-household and lives in the settings row.
function ownPhone(sock) {
  const id = sock?.user?.id;
  if (!id) return null;
  // Baileys hands back "<phone>:<device>@s.whatsapp.net"
  return id.split("@")[0].split(":")[0] || null;
}

function wasBotMentioned(msg, sock) {
  const phone = ownPhone(sock);
  if (!phone) return false;
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo;
  const mentioned = ctx?.mentionedJid || [];
  return mentioned.some((jid) => jid.split("@")[0].split(":")[0] === phone);
}

function isReplyToBot(msg, sock) {
  const phone = ownPhone(sock);
  if (!phone) return false;
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage || !ctx.participant) return false;
  // participant is the author of the message being replied to.
  return ctx.participant.split("@")[0].split(":")[0] === phone;
}

// ── Reminder helpers ─────────────────────────────────────────
const REMIND_RE = /^\/remind\s+(.+)/i;

function parseRemindDuration(raw) {
  const text = raw.trim();
  // Match leading duration tokens like 30m, 2h, 1d, 1h30m
  const durationRe = /^(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?/i;
  const m = text.match(durationRe);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;

  const days    = parseInt(m[1] || 0, 10);
  const hours   = parseInt(m[2] || 0, 10);
  const minutes = parseInt(m[3] || 0, 10);

  if (days === 0 && hours === 0 && minutes === 0) return null;

  const totalMs = ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
  const reminderText = text.slice(m[0].length).trim();
  return { ms: totalMs, message: reminderText || "(no message)" };
}

async function handleReminderCommand(text, remoteJid, senderJid, senderName, sock) {
  const m = text.match(REMIND_RE);
  if (!m) return false;

  const args = m[1].trim();
  const parsed = parseRemindDuration(args);

  if (!parsed || !parsed.message) {
    await sock.sendMessage(remoteJid, {
      text: "⏰ *Reminder format:* `/remind <duration> <message>`\nExamples:\n• `/remind 30m buy milk`\n• `/remind 2h call doctor`\n• `/remind 1d renew passport`\n• `/remind 1h30m check the oven`",
    });
    return true;
  }

  const remindAt = new Date(Date.now() + parsed.ms);

  try {
    // household_id is resolved server-side from group_jid — see
    // api/routers/reminders.py's internal_create_reminder.
    await api.post("/internal/reminders", {
      group_jid: remoteJid,
      sender_jid: senderJid,
      sender_name: senderName,
      message: parsed.message,
      remind_at: remindAt.toISOString(),
    });

    const when = remindAt.toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: true });
    await sock.sendMessage(remoteJid, {
      text: `⏰ Reminder set! I'll remind you at *${when}*:\n_${parsed.message}_`,
    });
  } catch (e) {
    console.error("[bot] reminder insert failed:", e.message);
    await sock.sendMessage(remoteJid, { text: "❌ Failed to set reminder. Please try again." });
  }
  return true;
}

// Poll for due reminders every 60 seconds
setInterval(async () => {
  if (!currentSock || !isConnected) return;
  try {
    const res = await axios.get(`${FASTAPI_URL}/internal/reminders/due`, { headers: iHeaders });
    const due = res.data?.reminders || [];
    for (const reminder of due) {
      try {
        await currentSock.sendMessage(reminder.group_jid, {
          text: `⏰ *Reminder* (set by ${reminder.sender_name || reminder.sender_jid}):\n${reminder.message}`,
        });
      } catch (e) {
        console.error("[bot] reminder send failed:", e.message);
      }
    }
  } catch (e) {
    console.error("[bot] reminder poll failed:", e.message);
  }
}, 60 * 1000);

// ── LangGraph message handler ────────────────────────────────
async function handleMessage(msg, sock) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid?.endsWith("@g.us")) return;

  const household_id = groupMap.get(remoteJid);
  if (!household_id) {
    console.log(`[bot] No household for group ${remoteJid} — skipping`);
    return;
  }

  const senderJid   = msg.key.participant || remoteJid;
  const senderPhone = senderJid.includes("@") ? senderJid.split("@")[0] : null;
  const senderName  = msg.pushName || null;

  const imgMsg =
    msg.message?.imageMessage ||
    msg.message?.viewOnceMessage?.message?.imageMessage ||
    msg.message?.viewOnceMessageV2?.message?.imageMessage ||
    msg.message?.ephemeralMessage?.message?.imageMessage ||
    msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.imageMessage;

  const docMsg =
    msg.message?.documentMessage ||
    msg.message?.ephemeralMessage?.message?.documentMessage;
  const hasPDF = docMsg && PDF_MIME_TYPES.has((docMsg.mimetype || "").toLowerCase());

  let payload;

  if (imgMsg || hasPDF) {
    const mediaMsg = hasPDF ? docMsg : imgMsg;
    const mimeType = (mediaMsg.mimetype || "image/jpeg").toLowerCase();

    try {
      const buffer = await downloadMediaMessage(
        msg, "buffer", {},
        { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage },
      );
      payload = {
        household_id,
        group_jid: remoteJid,
        thread_id: remoteJid,
        image_b64: buffer.toString("base64"),
        image_mime: mimeType,
        query: (imgMsg?.caption || docMsg?.caption || null),
        whatsapp_message_id: msg.key.id,
        sender_name: senderName,
        sender_phone: senderPhone,
      };
    } catch (e) {
      console.error("[bot] media download failed:", e.message);
      return;
    }
  } else {
    const rawText =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.ephemeralMessage?.message?.conversation ||
      msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
      "";
    if (!rawText.trim()) return;
    const text = stripLeadingMentions(rawText);
    if (!text) return;

    // Handle bot commands before forwarding to LangGraph
    if (await handleHelpCommand(text, remoteJid, sock)) return;
    if (await handleReminderCommand(text, remoteJid, senderJid, senderName, sock)) return;
    if (await handleCustomCommand(text, household_id, remoteJid, sock)) return;

    payload = {
      household_id,
      group_jid: remoteJid,
      thread_id: remoteJid,
      query: text,
      image_b64: null,
      image_mime: null,
      // Baileys can redeliver a message after a reconnect. The image path has
      // always sent this (receipt dedup); text needs it so a redelivery isn't
      // written into the conversation transcript twice and read back as the
      // group having said the same thing twice.
      whatsapp_message_id: msg.key?.id || null,
      // Without these the assistant has no idea who in the group it's talking
      // to — it can't greet them by name or apply a preference recorded against
      // them. The image path has always sent them; this one hadn't.
      sender_name: senderName,
      sender_phone: senderPhone,
      was_mentioned: wasBotMentioned(msg, sock),
      is_reply_to_bot: isReplyToBot(msg, sock),
    };
  }

  try {
    await sock.sendPresenceUpdate("composing", remoteJid);
    const result = await axios.post(
      `${FASTAPI_URL}/internal/graph-invoke`,
      payload,
      { headers: iHeaders, timeout: 90000 },
    );
    await sock.sendPresenceUpdate("paused", remoteJid);

    if (result.data?.response) {
      await sock.sendMessage(remoteJid, { text: result.data.response });
    } else if (!payload.image_b64 && result.data?.message_type === "unknown") {
      // Text message the graph couldn't classify — forward to webhook as before
      await forwardText(msg, payload.query);
    }
  } catch (e) {
    await sock.sendPresenceUpdate("paused", remoteJid).catch(() => {});
    console.error("[bot] graph-invoke failed:", e.response?.data || e.message);
  }
}

// NOTE: a commented-out handleHouseholdQuery() used to sit here, kept for
// rollback after the LangGraph migration. It authenticated to /query with
// `Authorization: Bearer ${SERVICE_KEY}` — the Supabase service role key used
// as an API token. That bypass no longer exists in the backend middleware and
// this process no longer has the key, so the snippet was removed rather than
// left as a template. Its replacement is the /internal/graph-invoke call above.

async function forwardText(msg, text) {
  const remoteJid = msg.key.remoteJid;
  const senderJid = msg.key.participant || remoteJid;

  if (!text || !text.trim()) return;

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

// LANGGRAPH MIGRATION - kept for rollback
// const RECIPE_TRIGGERS = /^(🛒|cook|recipe|ingredients|what do i need)/i;
// function isRecipeCaption(caption) {
//   return RECIPE_TRIGGERS.test((caption || "").trim());
// }

// LANGGRAPH MIGRATION - kept for rollback
// async function processRecipeImage(msg, sock) { ... }

// LANGGRAPH MIGRATION - kept for rollback
// async function processReceiptImage(msg, sock) { ... }

// LANGGRAPH MIGRATION - kept for rollback
// async function processReceiptDocument(msg, sock) { ... }

// ── Main socket ──────────────────────────────────────────────
async function startSock() {
  const { state, saveCreds, deleteSession, flush } = await useSupabaseAuthState(BOT_TENANT_ID, api);
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
      await refreshGroupMap();
      await refreshCustomCommands();
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
        if (reason === 405) {
          console.log(
            "[bot] 405 Method Not Allowed — WA protocol version mismatch " +
            "(Baileys' pinned version is likely stale). Will keep retrying " +
            "with backoff; this self-heals once the version catches up and " +
            "does NOT require a redeploy."
          );
        }
        // Never process.exit() here: on Railway a crash-loop burns the
        // platform's automatic-restart budget, and once that's exhausted
        // the service is left permanently "crashed" until someone manually
        // redeploys — which is exactly how a transient WA version mismatch
        // (405) turned into a multi-day outage. Retry forever in-process
        // instead, with capped exponential backoff, so a self-resolving
        // upstream issue self-heals without any human intervention.
        const backoffMs = Math.min(3000 * 2 ** Math.min(connectionFailures, 6), 60000);
        if (connectionFailures % 10 === 0) {
          console.log(`[bot] ${connectionFailures} consecutive failures — still retrying (backoff ${backoffMs}ms)`);
        }
        setTimeout(startSockWithRetry, backoffMs);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      // Skip own non-media messages (bot confirmations, etc.) but allow own images/PDFs
      const hasImage =
        msg.message?.imageMessage ||
        msg.message?.viewOnceMessage?.message?.imageMessage ||
        msg.message?.viewOnceMessageV2?.message?.imageMessage ||
        msg.message?.ephemeralMessage?.message?.imageMessage ||
        msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.imageMessage;
      const docMsg =
        msg.message?.documentMessage ||
        msg.message?.ephemeralMessage?.message?.documentMessage;
      const hasPDF = docMsg && PDF_MIME_TYPES.has((docMsg.mimetype || "").toLowerCase());
      if (msg.key.fromMe && !hasImage && !hasPDF) continue;
      await handleMessage(msg, sock);
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
