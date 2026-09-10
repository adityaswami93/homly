# 038 — Landing page positioning and hero A/B test — Release

## What was built

The public landing page (`/`) was rewritten and redesigned, and the waitlist now records
which of two hero framings a signup came from.

**Positioning.** The page previously described a receipt-scanning expense tracker. It now
presents Homly as a household manager for families, with two pillars —
*Your home* (chores, helper leave, pantry, shopping lists, daily nudges) and *Your money*
(receipts, budgets, reimbursement, insurance cover and gaps, savings and net worth, price
trends) — a section on how it behaves, and a section presenting WhatsApp and the dashboard
as two doors into the same assistant.

**Design.** The page was seven identically-styled centred blocks separated by hairline
rules. The hero is now asymmetric with the chat panel beside the copy (the product is
visible above the fold), sections alternate ground colour for rhythm, headings are
left-aligned with eyebrow labels, the accent colour is rationed rather than applied to
every icon, and the closing CTA is a single colour band.

**A/B test.** Two hero framings ship simultaneously:

| Variant | Headline |
|---|---|
| `manager` | Every home needs a manager. Now yours has one. |
| `system` | The operating system for your family. |

Visitors are assigned 50/50, sticky per browser via `localStorage`. `?v=manager` /
`?v=system` forces one for preview and is deliberately not persisted. The assigned variant
rides along on the waitlist POST and is stored on the row.

## Files changed

- `frontend/app/page.tsx` — full rewrite: new copy, new layout, `VARIANTS` map,
  `useVariant()` via `useSyncExternalStore`, `variant` sent on waitlist submit
- `frontend/lib/config.ts` — `tagline`, `description`, `elevator` rewritten to match
- `backend/api/routers/waitlist.py` — accepts optional `variant`, whitelists it against
  the two known values, stores `NULL` otherwise
- `backend/migrations/036_waitlist_variant.sql` — new
- `backend/alembic/versions/202608301000_036_waitlist_variant.py` — new
- `CLAUDE.md` — migration added to the Migrations tree
- `documents/README.md` — index row
- `documents/038-landing-page-positioning/` — this folder

## Database migrations

**`036_waitlist_variant.sql`** — adds `waitlist.variant TEXT` (nullable) plus
`idx_waitlist_variant`. Apply with `alembic upgrade head` from `backend/`.

Chained after `035_conversation_messages`. Both were originally written off
`034_bot_personality` on separate branches; leaving both pointing there would have given
Alembic two heads and failed `alembic upgrade head`. Re-pointed during the merge — the two
touch unrelated tables, so ordering between them carries no meaning.

## Environment variables

None.

## Deployment steps

Order matters:

1. **Migration first.** `alembic upgrade head`. The backend below inserts a `variant` key
   on every waitlist row; without the column those inserts fail.
2. **Backend second.** Deploying the frontend first is not dangerous but is pointless —
   Pydantic drops the unknown `variant` field, so signups during that window record `NULL`
   and are lost to the test.
3. **Frontend last.**

Rolling back the frontend alone is safe: the backend treats a missing `variant` as `NULL`.

## How to verify

- Load `/?v=system` and `/?v=manager` — the headline and subhead should differ; everything
  below the hero should be identical.
- Load `/` with no parameter, then reload — the variant must not change. Check
  `localStorage.getItem('homly_lp_variant')`.
- Submit a test email, then confirm the row carries a variant:
  ```sql
  SELECT email, variant, created_at FROM waitlist ORDER BY created_at DESC LIMIT 5;
  ```
- Reading the result later:
  ```sql
  SELECT variant, COUNT(*) FROM waitlist WHERE variant IS NOT NULL GROUP BY variant;
  ```

## Verification actually performed

Run in this environment, all passing:

- `ruff check .` from `backend/`, with ruff pinned to **0.15.8** to match CI — an
  unpinned install resolved a newer ruff whose default rules flagged pre-existing files,
  which is the trap `.github/workflows/ci.yml` already warns about
- `python -m py_compile` on the changed router and the new revision
- `tsc --noEmit` and `eslint` on `frontend/app/page.tsx` and `frontend/lib/config.ts`
- `next build` (production, static export)
- Rendered in headless Chromium at 1440px and 390px; both variants confirmed to render
  with no console or hydration errors, and sticky assignment confirmed across a reload
- Alembic chain verified to have exactly one head after the merge

**Not run:** the migration itself has not been applied against any database, and no
waitlist insert has been exercised end-to-end — this environment has no Supabase
credentials. The `variant` column reaching the row is therefore verified by reading the
code, not by observing it. Confirm with the SQL above after deploying.

## Known issues

- **No impressions are recorded**, only signups. Comparing raw counts per variant is valid
  only because assignment is a 50/50 coin. It is not a true conversion rate and will
  mislead if the split changes or traffic is driven to one variant via `?v=`.
- **No significance test.** Reading the result is a human judgement on the counts.
- **The page still has no proof** — no testimonial, no signup count, no real screenshot.
  The chat panel is a mock with invented names. This is the largest remaining weakness and
  needs a real artifact.
- **Privacy remains FAQ item five**, collapsed, on a product that reads every household
  receipt.
