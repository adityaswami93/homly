# 042 — Photo memory + voucher wallet — Release

## What changed for the household

- **Send any photo and @mention the assistant** (or reply to it, or use `always` mode):
  it reads the photo, says what it is with the key dates/amounts, and offers numbered
  options — e.g. *"1. Remind us to pay the $12 fee on 6 Nov  2. Nothing for now — just
  keep it"*. Answer with the number or in your own words.
- **It remembers what it read.** "What did the school letter say about the excursion?"
  works days later. Photos are forgotten after 365 days, or on request ("forget that
  photo", or the Docs page).
- **Voucher wallet.** Send a voucher photo (or caption it "voucher"), paste a promo
  message, or say "save code SAVE20, 20% off Lazada till 30 Nov" — it's saved. Ask "any
  codes for Grab?", say "used the FairPrice one". The daily check-in mentions vouchers
  about to expire.
- **Reminders from chat** — "remind us on 6 Nov at 6pm to pay the fee" now works, not
  just `/remind 2h …`.
- **Dashboard:** new **Vouchers** app (Wallet with copy-code, expiring-soon section,
  upload/paste/type to add; Used & Expired history) and **Docs** app (search, view
  text + image, forget).
- Unrecognised photos that *aren't* addressed are still ignored and not stored.

## Files changed

Backend
- `migrations/038_household_documents.sql`, `migrations/039_vouchers.sql` + Alembic
  revisions `202610280900_038_household_documents.py`, `202610280910_039_vouchers.py`
- `services/documents.py` (new) — store/search/purge read photos; `RETENTION_DAYS`
- `services/vouchers.py` (new) — all voucher rules
- `services/household_time.py` (new) — household-local today/timezone
- `services/llm_client.py` — `parse_json_object()`
- `services/bot_profile.py` — `voucher` always engages
- `services/whatsapp_scheduler.py` — daily `_purge_expired_documents` (03:17 SGT)
- `agents/document_reader.py`, `agents/voucher_agent.py` (new) — vision/text extraction
- `agents/query/documents_agent.py`, `agents/query/vouchers_agent.py` (new);
  `agents/query/reminders_agent.py` — `create_reminder`
- `agents/orchestrator/registry.py` — registers both; `describe_capabilities()`
- `agents/orchestrator/supervisor.py` — prompt: answering a photo's options, query_documents
- `agents/proactive_agent.py` — read-only intents for the new agents; reminders narrowed
- `agents/homly_graph.py` — `voucher` type + caption keywords, `read_image_node`,
  `voucher_node`; `unsupported_image_node` is now only the unreadable-photo fallback
- `api/routers/vouchers.py`, `api/routers/documents.py` (new); `api/main.py`
- `whatsapp/index.js` — photo captions carry `was_mentioned`/`is_reply_to_bot`
- `tests/test_vouchers.py`, `tests/test_photo_memory.py` (new);
  `tests/test_classify_node_images.py`, `tests/check_household_scoping.py` updated

Frontend
- `config/apps.ts`, `app/components/shell/icons.tsx` — Vouchers + Docs apps
- `app/(shell)/vouchers/page.tsx`, `vouchers/history/page.tsx`, `vouchers/VoucherParts.tsx`
- `app/(shell)/documents/page.tsx`

## Database migrations

```bash
cd backend && alembic upgrade head     # 038_household_documents, then 039_vouchers
```

Both create a **private Storage bucket** (`household-documents`, `vouchers`). If the
migration role can't write `storage.buckets` you'll see a NOTICE, not an error — then
create both buckets by hand: Supabase → Storage → New bucket → name as above, **Private**.
Without the buckets everything still works except images (vouchers without a code
can't be saved without one; read photos are stored text-only).

## Environment variables

None.

## Deploy order

1. Migrations (new tables only — old code doesn't read them, nothing narrows).
2. Backend.
3. WhatsApp bot (`whatsapp/index.js`) — optional for the rest to work; without it,
   only a typed bot name in a caption addresses the bot on a photo, not a real @mention.
4. Frontend.

## How to verify

1. In the group, send a photo of a letter/bill with caption "@<bot> what's this?" →
   reply starts `📄 *…*` with facts and numbered options. Reply "1" → the action is
   confirmed (e.g. "Reminder set for …"). `select title, expires_at from
   household_documents order by created_at desc limit 1;` shows the row, expiring ~1 year out.
2. Next day, ask "what did that letter say?" → answered from the stored text.
3. Send a voucher screenshot with caption "voucher" → `🎟️ Saved to the voucher wallet: …`.
   It appears under Vouchers → Wallet. Send it again → "Already in the wallet".
4. Send an unrelated photo with no caption in `smart` mode → no reply, no new
   `household_documents` row.
5. Dashboard → Vouchers → Add → paste "Use SAVE20 for 20% off Lazada till 30 Nov" →
   review form is prefilled → save → card shows the code with Copy.

## Verification done before shipping

- Backend: `pytest tests/` — 124 passed (97 existing + 27 new), `ruff check .` clean
  (ruff 0.15.8, as CI pins). Run locally with Python 3.13 rather than CI's 3.11, and
  without `psycopg[binary]` (no matching wheel here; nothing under test imports it).
- Migrations: applied to a scratch PostgreSQL 16 with stub `households`/`auth.users`/
  `storage.buckets` tables — both apply, re-apply idempotently, full-text search matches,
  the duplicate-code unique index rejects `lazada`/`save20` after `Lazada`/`SAVE20`, both
  buckets are created; and with no `storage` schema the migration still succeeds with a
  NOTICE. Not run against real Supabase.
- Frontend: `tsc --noEmit` clean, ESLint clean on all new/changed files, `next build`
  succeeds (Next 16.4.0 prints a security-advisory notice and exits on the first run of
  each build; a re-run completes — pre-existing, unrelated to this change). The Wallet,
  Used & Expired and Docs pages were rendered in headless Chromium against the static
  export with mocked API responses, at 1280px and 390px wide.
- **Not verified:** any real LLM call (prompts were not exercised against the vision
  model), the WhatsApp bot change on a live socket, and the pages in a browser against a
  live backend.

## Known issues

- A late answer (>10 min) to the "what should I do?" question that isn't a WhatsApp
  reply may be ignored, as with any late follow-up — reply to the bot's message instead.
- Merchant matching for "any codes for Grab?" is a substring match.
- See implementation.md "What was left out".
