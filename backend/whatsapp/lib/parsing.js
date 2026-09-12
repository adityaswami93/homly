// Pure message-parsing helpers, extracted from index.js so they can be tested.
//
// Everything here is a pure function of its arguments: no Baileys socket calls,
// no network, no module state. That is the whole point — index.js is a single
// 700-line file whose other functions all reach for a socket or the backend,
// and these five were the parts where a silent regression is both most likely
// and most damaging.
//
// Tested by lib/parsing.test.js (`node --test`, no dependencies).

// A household member @-mentioning the bot leaves a literal "@<phone> " (or
// "@<name> ") prefix in the message text, which breaks every prefix-based match
// downstream: custom commands, /remind, and classify_node's text_query
// detection in homly_graph.py all check how the string *starts*. Strip any
// leading mention tokens before those checks run.
export function stripLeadingMentions(text) {
  return text.replace(/^(@\S+\s*)+/, "").trim();
}

// Stripping the mention above throws away a fact the backend cannot recover:
// that this message was aimed at the bot. The household's engagement mode
// (settings.bot_engagement_mode) decides whether an un-addressed message gets a
// reply at all, so both signals below are forwarded to /internal/graph-invoke
// alongside the cleaned text. Detecting the bot's *name* is left to the backend
// — the name is per-household and lives in the settings row.
export function ownPhone(sock) {
  const id = sock?.user?.id;
  if (!id) return null;
  // Baileys hands back "<phone>:<device>@s.whatsapp.net"
  return id.split("@")[0].split(":")[0] || null;
}

function contextInfo(msg) {
  return (
    msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo
  );
}

export function wasBotMentioned(msg, sock) {
  const phone = ownPhone(sock);
  if (!phone) return false;
  const mentioned = contextInfo(msg)?.mentionedJid || [];
  return mentioned.some((jid) => jid.split("@")[0].split(":")[0] === phone);
}

export function isReplyToBot(msg, sock) {
  const phone = ownPhone(sock);
  if (!phone) return false;
  const ctx = contextInfo(msg);
  if (!ctx?.quotedMessage || !ctx.participant) return false;
  // participant is the author of the message being replied to.
  return ctx.participant.split("@")[0].split(":")[0] === phone;
}

export const REMIND_RE = /^\/remind\s+(.+)/i;

export function parseRemindDuration(raw) {
  const text = raw.trim();
  // Match leading duration tokens like 30m, 2h, 1d, 1h30m
  const durationRe = /^(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?/i;
  const m = text.match(durationRe);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;

  const days = parseInt(m[1] || 0, 10);
  const hours = parseInt(m[2] || 0, 10);
  const minutes = parseInt(m[3] || 0, 10);

  if (days === 0 && hours === 0 && minutes === 0) return null;

  const totalMs = ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
  const reminderText = text.slice(m[0].length).trim();
  return { ms: totalMs, message: reminderText || "(no message)" };
}
