// Run with: node --test  (from backend/whatsapp)
//
// backend/whatsapp/ had no tests, no lint and no CI job at all — the component
// that actually talks to households was the least covered thing in the repo.
// These cover the parsing that decides whether the bot understands a message,
// and are dependency-free on purpose so they run without `npm install`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isReplyToBot,
  ownPhone,
  parseRemindDuration,
  stripLeadingMentions,
  wasBotMentioned,
} from "./parsing.js";

const BOT_PHONE = "6591234567";
const sock = { user: { id: `${BOT_PHONE}:12@s.whatsapp.net` } };

function withContext(contextInfo, { ephemeral = false } = {}) {
  const extendedTextMessage = { contextInfo };
  return ephemeral
    ? { message: { ephemeralMessage: { message: { extendedTextMessage } } } }
    : { message: { extendedTextMessage } };
}

describe("stripLeadingMentions", () => {
  // Without this, @-mentioning the bot broke every prefix-based match:
  // custom commands, /remind, and classify_node's text_query detection all
  // check how the string *starts*.
  it("strips a leading mention so a command still matches", () => {
    assert.equal(stripLeadingMentions("@6591234567 /remind 30m milk"), "/remind 30m milk");
  });

  it("strips several stacked mentions", () => {
    assert.equal(stripLeadingMentions("@alice @bob what did we spend?"), "what did we spend?");
  });

  it("leaves a message with no mention untouched", () => {
    assert.equal(stripLeadingMentions("what did we spend?"), "what did we spend?");
  });

  it("does not strip a mention that appears mid-message", () => {
    // Only a leading mention is the addressing signal; one in the middle is
    // part of what the person said.
    assert.equal(stripLeadingMentions("tell @bob about it"), "tell @bob about it");
  });

  it("returns an empty string for a mention-only message", () => {
    assert.equal(stripLeadingMentions("@6591234567"), "");
    assert.equal(stripLeadingMentions("@6591234567   "), "");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(stripLeadingMentions("   hello   "), "hello");
  });
});

describe("ownPhone", () => {
  it("drops the device suffix and domain Baileys appends", () => {
    assert.equal(ownPhone(sock), BOT_PHONE);
  });

  it("handles an id with no device suffix", () => {
    assert.equal(ownPhone({ user: { id: `${BOT_PHONE}@s.whatsapp.net` } }), BOT_PHONE);
  });

  it("returns null rather than throwing when the socket has no user yet", () => {
    // Messages can arrive before the socket is fully identified; the
    // addressing checks below must degrade to "not addressed", not crash.
    assert.equal(ownPhone(undefined), null);
    assert.equal(ownPhone({}), null);
    assert.equal(ownPhone({ user: {} }), null);
  });
});

describe("wasBotMentioned", () => {
  it("matches the bot's own jid regardless of device suffix", () => {
    const msg = withContext({ mentionedJid: [`${BOT_PHONE}:3@s.whatsapp.net`] });
    assert.equal(wasBotMentioned(msg, sock), true);
  });

  it("ignores a mention of someone else", () => {
    const msg = withContext({ mentionedJid: ["6599999999@s.whatsapp.net"] });
    assert.equal(wasBotMentioned(msg, sock), false);
  });

  it("reads the contextInfo inside an ephemeral (disappearing) message", () => {
    const msg = withContext({ mentionedJid: [`${BOT_PHONE}@s.whatsapp.net`] }, { ephemeral: true });
    assert.equal(wasBotMentioned(msg, sock), true);
  });

  it("is false for a plain message with no contextInfo", () => {
    assert.equal(wasBotMentioned({ message: { conversation: "hi" } }, sock), false);
    assert.equal(wasBotMentioned({}, sock), false);
  });

  it("is false when the socket has no identity", () => {
    const msg = withContext({ mentionedJid: [`${BOT_PHONE}@s.whatsapp.net`] });
    assert.equal(wasBotMentioned(msg, {}), false);
  });
});

describe("isReplyToBot", () => {
  it("is true when the quoted message was authored by the bot", () => {
    const msg = withContext({
      quotedMessage: { conversation: "SGD 82 so far." },
      participant: `${BOT_PHONE}:3@s.whatsapp.net`,
    });
    assert.equal(isReplyToBot(msg, sock), true);
  });

  it("is false when replying to another member", () => {
    const msg = withContext({
      quotedMessage: { conversation: "ok" },
      participant: "6599999999@s.whatsapp.net",
    });
    assert.equal(isReplyToBot(msg, sock), false);
  });

  it("is false when the bot is merely mentioned, with nothing quoted", () => {
    const msg = withContext({ participant: `${BOT_PHONE}@s.whatsapp.net` });
    assert.equal(isReplyToBot(msg, sock), false);
  });
});

describe("parseRemindDuration", () => {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("parses minutes, hours and days", () => {
    assert.deepEqual(parseRemindDuration("30m buy milk"), { ms: 30 * MIN, message: "buy milk" });
    assert.deepEqual(parseRemindDuration("2h call doctor"), { ms: 2 * HOUR, message: "call doctor" });
    assert.deepEqual(parseRemindDuration("1d renew passport"), { ms: DAY, message: "renew passport" });
  });

  it("parses a compound duration", () => {
    assert.deepEqual(parseRemindDuration("1h30m check the oven"), {
      ms: HOUR + 30 * MIN,
      message: "check the oven",
    });
  });

  it("parses days, hours and minutes together", () => {
    assert.equal(parseRemindDuration("1d2h3m x").ms, DAY + 2 * HOUR + 3 * MIN);
  });

  it("returns null when there is no leading duration", () => {
    // handleReminderCommand replies with the usage hint on null, so this is
    // the branch that decides whether a typo gets help or silence.
    assert.equal(parseRemindDuration("buy milk"), null);
    assert.equal(parseRemindDuration(""), null);
  });

  it("returns null for an all-zero duration", () => {
    assert.equal(parseRemindDuration("0m nothing"), null);
    assert.equal(parseRemindDuration("0d0h0m nothing"), null);
  });

  it("falls back to a placeholder when only a duration was given", () => {
    assert.deepEqual(parseRemindDuration("30m"), { ms: 30 * MIN, message: "(no message)" });
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    assert.deepEqual(parseRemindDuration("  30M  buy milk  "), { ms: 30 * MIN, message: "buy milk" });
  });

  it("keeps the rest of the message intact, including digits", () => {
    assert.equal(parseRemindDuration("2h pay the 50 dollar bill").message, "pay the 50 dollar bill");
  });
});
