# Release 012 — Reimbursement History

## Summary

Adds a reimbursements tracking page so household admins can see which weeks have outstanding helper/cleaner payments, record full or partial payments, and view a complete payment history per week.

---

## What's new

### `/reimbursements` page (frontend)

A new dashboard page reachable from the top nav ("Reimburse") and the mobile bottom bar.

- **Summary cards** — outstanding total, total paid to date, all-time reimbursable spend
- **Filter tabs** — switch between All weeks / Unpaid only / Settled only
- **Per-week accordion** — expand any week to see:
  - Payment history with dates, amounts, and notes
  - Total reimbursable vs. paid vs. outstanding breakdown
  - One-click full payment button
  - Custom partial payment input
  - Remove individual payment records
- **Status badges** — Unpaid / Partial / Settled at a glance on every row

### API changes

| Change | Detail |
|--------|--------|
| `GET /weeks` updated | Now returns `reimbursable_total`, `receipt_count`, `flagged_count`, and `total` per week. Previously returned only year, week number, and date range. |
| `GET /reimbursements` | *(existing)* All payment records for the household |
| `POST /reimbursements` | *(existing)* Record a payment against a week |
| `DELETE /reimbursements/{id}` | *(existing)* Remove a payment record |

### Navigation

"Reimburse" added to the nav bar between Dashboard and History on both desktop and mobile.

---

## Migration required

Run `013_reimbursement.sql` in the Supabase SQL editor if not already applied. This migration:

- Adds `reimbursable BOOLEAN DEFAULT true` to `receipts`
- Adds `reimbursement_mode TEXT DEFAULT 'all'` to `settings`
- Adds `helper_identifiers TEXT DEFAULT ''` to `settings`
- Creates the `reimbursements` table

---

## Files changed

| File | Change |
|------|--------|
| `backend/api/routers/expenses.py` | `GET /weeks` — rewritten to aggregate per-week totals |
| `backend/api/routers/reimbursements.py` | *(existing)* No changes |
| `frontend/app/reimbursements/page.tsx` | New page |
| `frontend/app/components/Navbar.tsx` | Added Reimburse nav item and `IconReimburse` |
| `backend/migrations/013_reimbursement.sql` | *(existing)* Schema for this feature |
| `docs/features/reimbursements.md` | Implementation documentation |

---

## Testing checklist

- [ ] Weeks with no reimbursable receipts do not appear on the page
- [ ] Outstanding = reimbursable total − sum of payments; updates after each action
- [ ] Full payment sets status to Settled; partial sets to Partial
- [ ] Removing a payment correctly restores the outstanding amount
- [ ] Filter tabs show correct counts and filter correctly
- [ ] `GET /weeks` returns `reimbursable_total` and `receipt_count` for existing data
- [ ] Reimburse nav item highlights correctly when on `/reimbursements`
- [ ] Mobile bottom nav shows Reimburse between Dashboard and History
