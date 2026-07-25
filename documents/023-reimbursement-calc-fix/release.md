# 023 — Reimbursement Total Calculation Fix — Release

## What was built
Fixed the "to reimburse" total on the Expenses Overview page showing an incorrect amount, by moving reimbursement-week matching and "already paid" aggregation from the frontend into the backend. Also deduplicated the `get_reimbursable()` eligibility helper across routers, and added five new conventions to CLAUDE.md.

## Files changed
- `backend/api/routers/expenses.py` — added `_reimbursement_groups()` / `_paid_for_week()` helpers; `GET /receipts/daterange` now returns `already_paid` and `outstanding_reimbursable_total`; added `POST /receipts/daterange/mark-paid`; removed the local `get_reimbursable()` copy.
- `backend/api/routers/webhook.py` — removed the local `_get_reimbursable()` copy, imports the shared one.
- `backend/services/reimbursement.py` — new file, the single `get_reimbursable()` implementation.
- `backend/services/receipt_service.py` — replaced a lazy cross-layer import (`from api.routers.expenses import get_reimbursable`) with a normal top-level import of the shared service function.
- `frontend/app/(shell)/expenses/page.tsx` — `loadDateRange` and `handleMarkPaid` now just call the backend and render the returned values; removed all client-side ISO-week/grouping logic.
- `CLAUDE.md` — added "Keep This File in Sync", "Frontend stays thin — business logic lives in the backend", "Backend stays DRY", "Multi-tenancy: every query must filter by household_id", and "check migration numbers before creating one" sections.

## Database migrations
None. No schema changes — uses the existing `reimbursements` and `receipts` tables as-is.

## Environment variables
None added.

## Deployment steps
Standard deploy (Railway backend / Vercel frontend on merge to `main`). No manual steps.

## Known issues
- Other frontend files still contain similar client-side business logic that should eventually move server-side — see CLAUDE.md's "Frontend stays thin" section for the current list (`expenses/reimburse/page.tsx`'s multi-endpoint join, duplicated `getWeekRange`/`daysUntil` helpers, `insurance/page.tsx`'s premium normalization, `savings/page.tsx`'s parallel net-worth calc). Not addressed in this PR.
- `documents/README.md`'s issue index table only lists up to #017; #018–#022 (already shipped) and #023 (this PR) are not yet backfilled there.
