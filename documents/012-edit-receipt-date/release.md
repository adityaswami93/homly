# 013 — Edit Receipt Date — Release

## What was built

Admins and super admins can correct the date of any receipt from the receipt drawer. The change cascades to `week_number` / `year` on the receipt and all its items, moving the receipt to the correct week automatically.

## Files changed

- `backend/api/routers/expenses.py` — added `PATCH /receipts/{receipt_id}/date` endpoint; admin + super-admin only; recalculates ISO week, updates `receipts` and `items` tables
- `frontend/app/dashboard/page.tsx`
  - `ReceiptDrawer`: new props `isAdmin`, `onDateChange`; inline date editor (edit/save/cancel) shown only to admins
  - `Dashboard`: new `isAdmin` state (derived from `/household` members + `is_super_admin`); new `handleDateChange` callback — removes receipt from view if week changed, updates date in place if same week

## Database migrations

None — uses existing `date`, `week_number`, `year` columns on `receipts` and `receipt_date`, `week_number`, `year` on `items`.

## Environment variables

None.

## Deployment steps

Frontend + backend deploy. No manual steps.

## Known issues

None.
