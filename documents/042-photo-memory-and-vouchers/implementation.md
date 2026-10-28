# 042 — Photo memory (read, ask, remember) + voucher wallet

## Problem

Two requests from the household, which turned out to share a front door:

1. **"Track and manage vouchers and promo codes easily — add or upload them via the
   platform or the WhatsApp bot."** There was nowhere to keep them. A voucher photo in
   the group was classified `other_image`; a pasted promo SMS went to the chat
   supervisor, which had no tool to store it.
2. **"The bot should take in a picture, read it, ask what should be done based on the
   text, and store it so it can be referred to in future conversations."** Any photo
   that wasn't a receipt, a dish or a fridge got this, verbatim, from
   `unsupported_image_node`:

   > 📷 I can't tell what this photo is for — I can help with receipts, fridge/pantry
   > photos, and dishes you want ingredient help with.

   and the transcript (`services/conversation.py`) recorded it as
   `[sent a photo] <caption>`. A school letter, a bill, an appointment card or a
   screenshot of a message was unreadable *and* unrecallable — the assistant couldn't
   act on it, and couldn't answer "what did that letter say?" the next day, because
   nothing of the letter was ever stored and the conversation window is 6 hours.

## Root cause

`classify_node`'s image branch only knew three useful photo types; everything else was
a dead end by design (`unsupported_image_node`'s docstring explained why: the chat
supervisor only ever sees caption text, so handing it the photo would be a confident
guess about an image nobody read). That reasoning was right — the fix is to *read* the
photo first, not to hand it to the supervisor unread.

## Solution

### Photo memory

```
photo → classify_node
          ├─ receipt / recipe / fridge_scan       (unchanged)
          ├─ voucher (vision type, or caption has "voucher"/"promo"/"coupon"…)
          │     → voucher_node: extract → save to wallet → "🎟️ Saved…"
          │       (not a voucher after all → treated as other_image, gate included)
          └─ other_image, ENGAGED only (addressed, or engagement mode 'always')
                → read_image_node
                    agents/document_reader.read_image()   one vision call: title, summary,
                                                          full text, key facts, 1–3 actions
                    services/documents.save_document()    household_documents row + image
                    reply: "📄 *title* / summary / • facts / What would you like me to do?
                            1. … 2. … N. Nothing for now — just keep it"
```

The next message ("1", "remind me the day before", "save it as a voucher") is an
ordinary follow-up: it is `addressed` through the existing signals (a WhatsApp reply to
the bot, or `is_awaiting_reply` within 10 minutes), and the chat supervisor resolves it
against the transcript — the reply above is what was recorded as the assistant's turn,
so the options and the dates/amounts are right there. The supervisor's prompt now says
how to treat a numbered choice, and it has the tools to act:

- `query_reminders.create_reminder` — **new**; reminders could previously only be made
  with the bot's `/remind 2h …` command, which can't express "6 Nov at 6pm".
- `query_vouchers.save_from_document` — re-extracts a voucher from the stored text.
- `query_tasks`, `query_pantry`, `query_preferences` — existing writes.
- `query_documents` — **new**; search / recent / get / forget over stored photos. This is
  what makes a photo referable *later*: it's a registered agent, so "what did the school
  letter say about the excursion?" works a month on, from any conversation.

What the reader may offer is constrained: `registry.describe_capabilities()` lists the
actions (hand-picked per tool, filtered to registered tools) and the prompt forbids
anything else, so the group is never offered something the assistant can't do.

### Voucher wallet

`vouchers` table + `services/vouchers.py`, which owns every rule (below). Four ways in,
all through `create_voucher()`: the dashboard form, a dashboard upload or pasted text
(`POST /vouchers/extract` → review → `POST /vouchers`), a voucher photo in the group
(`voucher_node`), and the chat agent (pasted promo message, "save code X", "save it as a
voucher"). Shown on a new **Vouchers** app (Wallet, Used & Expired), in chat
(`query_vouchers`), and nudged by the proactive monitor (`expiring_soon` is a read
intent; `finding_key = voucher_expiring:<id>` so the 24h dedup applies per voucher).

## Decisions, and the approaches that looked obvious and were wrong

- **Don't add a pending-answer table for "what should I do with this?".** The pantry
  flow has one (`pantry_pending_confirmations`) because a bare "yes" is meaningless
  without it and `interrupt()` doesn't work (see `021`). Here the options are free-form
  and numbered, and the supervisor already resolves free-form follow-ups from the
  transcript (`037`). A second join table would be a second source of truth for "what
  is the group answering" that can disagree with the transcript. Don't reintroduce
  `interrupt()` here either, for the reasons `021` gives.
- **Don't route an unread photo to the supervisor.** Still true — the change is that the
  supervisor now gets the *reading*, never the bare photo.
- **Don't read every photo.** Only engaged photos are read and stored. In the default
  `smart` mode an unaddressed family photo stays exactly as silent and unprocessed as
  before. Reading every image in a family group would be an archive of the family's
  photos nobody asked for. **Deliberately narrow — don't "fix" it** by adding
  `other_image` to `_ALWAYS_ENGAGE`.
- **Vouchers *are* always-engage** (`_ALWAYS_ENGAGE`, like receipts): a voucher sent to
  the group is a deliberate act. But a photo that the classifier or caption *called* a
  voucher and that extraction says isn't one is put back through the `other_image` gate
  in `voucher_node` — otherwise the word "promo" in a caption would bypass the privacy
  rule above.
- **"Expired" is derived, never stored**, from `expires_at` against today in the
  household's timezone (`services/household_time.py`; `settings.summary_timezone`). A
  stored `expired` status would need a job to flip it and would be wrong between runs.
  The expiry date itself is still usable.
- **Dedup in Python, not `ilike`.** `_existing_duplicate()` compares merchant+code
  case-insensitively over the household's vouchers (tens, not thousands). An `ilike`
  pattern would treat `_`/`%` in a promo code as wildcards. The unique index
  `(household_id, lower(merchant), lower(code))` is the backstop for races.
- **Keep the image even when there's a code.** A barcode/QR voucher *is* its image, and
  for a typed code the image is how a household checks an OCR misread (`confidence:
  low` is surfaced in the reply and on the card).
- **Voucher images are copied, not referenced**, when saved from a read photo
  (`vouchers_agent._copy_image`) — documents expire on their own schedule and the
  voucher must not lose its image with them.
- **Retention is a code setting** (as asked: "configurable at code basis"):
  `services/documents.RETENTION_DAYS = 365`. Each row gets its own `expires_at` on
  insert so one row can be kept longer by editing it, without a household setting.
  Expired rows are hidden from every read immediately (`_live()`), and physically
  deleted with their images by the 03:17 SGT `_purge_expired_documents` job.
- **Search is Postgres full-text with the `simple` config**, not `english`: households
  write in several languages and stemming English rules onto Malay/Tamil/Chinese hurts.
  No embeddings yet.
- **`query_reminders` in `_READONLY_INTENTS` changed from `None` (all intents) to the two
  read intents** — adding `create_reminder` would otherwise have silently given the
  unattended proactive loop a write. Same check for the two new agents.
- **One-time codes and vouchers only** (as asked). No balance column; gift cards with a
  running balance are out of scope rather than half-supported.

## What was left out

- **Spotting a used voucher from a receipt** ("you had a $10 FairPrice voucher — did you
  use it?"). Needs `receipt_node` to look up active vouchers by vendor; the merchant
  matching in `vouchers._matches_merchant` is a naive substring match and would need the
  vendor canonicalisation `price_history` uses first.
- **Uploading a document from the dashboard.** Reading ends in a question, and that
  conversation lives in WhatsApp; the Docs page is browse/search/forget only.
- **Late answers without a reply.** If someone answers the "what should I do?" question
  more than 10 minutes later *without* using WhatsApp's reply, in `mentioned` mode (or
  in `smart` mode when the text classifies as `unknown`) the gate stays silent, exactly
  as for any other late follow-up. Replying to the bot's message always works.
- **MCP tools** for vouchers/documents.
- **Gift card balances**, multiple uses per code, sharing a voucher with a specific member.

## Technical notes

- `services/llm_client.parse_json_object()` is now the one JSON-unwrapping helper
  (fences, leading prose); `homly_graph._parse_json_object` delegates to it.
- A reading with neither summary nor text is a failed read (`document_reader`), so the
  group gets the honest fallback rather than "📄 Photo" with nothing in it.
- The bot now sends `was_mentioned`/`is_reply_to_bot` for photos too
  (`messageContextInfo()` in `whatsapp/index.js` reads the media message's contextInfo),
  so "@Homly what's this?" as a caption addresses the bot.
- `_format_reading()` is capped to fit `conversation._MAX_CONTENT_CHARS` (800) — it's the
  assistant turn the follow-up is resolved against; a test pins this.
