# 013 — Edit Receipt Date

## Problem

Receipt dates are extracted by OCR and are sometimes wrong (e.g. OCR misreads the date, or the photo is uploaded days after purchase). There was no way to correct the date without going directly to the database.

## Solution

Household admins and super admins can edit the date of any receipt directly from the receipt drawer on the dashboard. Changing the date also updates `week_number` and `year` on the receipt and all its line items, so the receipt moves to the correct week automatically.

### UX flow

1. Admin clicks a receipt row → drawer opens
2. Date line shows the current date with a subtle **Edit** link next to it (only visible to admins / super admins)
3. Clicking Edit replaces the date text with a `<input type="date">` pre-filled with the current date, plus **Save** and **Cancel** buttons
4. Admin picks a new date and clicks Save → `PATCH /receipts/{id}/date`
5. If the new date is in the **same ISO week**: date updates in place, drawer stays open
6. If the new date is in a **different ISO week**: receipt is removed from the current week view and drawer closes (it now lives in the new week)

### Admin check

- **Frontend**: `isAdmin = myMember?.role === "admin" || is_super_admin`
  Resolved on dashboard mount from `GET /household` + `session.user.user_metadata.is_super_admin`
- **Backend**: `role == "admin"` OR `is_super_admin` from JWT claims (set by auth middleware from `household_members.role` and `user_metadata`)

## Technical notes

- `week_number` and `year` are denormalised on both `receipts` and `items` tables and must stay in sync — the endpoint updates both in one request
- `_week_for_date()` uses Python's `date.isocalendar()` (ISO 8601 week), consistent with how the bot assigns weeks on receipt ingestion
- The date input uses `type="date"` which renders the native browser date picker — no external dependency
- `isAdmin` state is set once on mount (not re-fetched); this is fine because role changes within a session are extremely rare for this use case
