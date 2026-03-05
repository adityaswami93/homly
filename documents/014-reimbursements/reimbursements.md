# Reimbursements Feature

## Overview

The reimbursements feature tracks money owed to household members who submit receipts via WhatsApp (e.g. a cleaner or helper). Admins view outstanding amounts week-by-week on the `/reimbursements` dashboard page and record partial or full payments against each week.

---

## Database Schema

### Migration: `013_reimbursement.sql`

**`receipts.reimbursable`** `BOOLEAN DEFAULT true`
Added to the `receipts` table. Set automatically at ingestion time by `get_reimbursable()` in `expenses.py` based on the household's `reimbursement_mode` setting.

**`settings.reimbursement_mode`** `TEXT DEFAULT 'all'`
Controls which receipt senders are marked reimbursable:

| Value | Behaviour |
|-------|-----------|
| `all` | Every receipt is reimbursable (default) |
| `none` | No receipts are reimbursable |
| `helpers_only` | Only receipts whose `sender_name` or `sender_phone` appears in `helper_identifiers` |

**`settings.helper_identifiers`** `TEXT DEFAULT ''`
Comma-separated list of phone numbers or display names used when `reimbursement_mode = 'helpers_only'`. Matching is case-insensitive on names and exact on phone numbers.

**`reimbursements`** table — one row per payment event:

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | `gen_random_uuid()` |
| household_id | UUID FK → households | Cascade delete |
| year | INT | ISO year of the week being settled |
| week_number | INT | ISO week number being settled |
| amount | NUMERIC(10,2) | Amount paid in this event |
| paid_at | TIMESTAMPTZ | `DEFAULT NOW()` |
| note | TEXT | Optional free-text note |
| created_by | UUID FK → auth.users | Who recorded the payment |
| created_at | TIMESTAMPTZ | `DEFAULT NOW()` |

Indexes: `idx_reimbursements_household` on `(household_id)`, `idx_reimbursements_week` on `(year, week_number)`.

---

## Backend

### Router: `backend/api/routers/reimbursements.py`

All endpoints require JWT auth. `household_id` is resolved from `request.state.user` (set by `AuthMiddleware`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reimbursements` | All records for the household, ordered `paid_at DESC` |
| POST | `/reimbursements` | Insert a payment. Body: `{ year, week_number, amount, note? }` |
| DELETE | `/reimbursements/{id}` | Delete a record. Validates `household_id` ownership before deleting. |
| GET | `/reimbursements/week/{year}/{week_number}` | Records for one week + `total_paid` aggregate |

### Updated endpoint: `GET /weeks` (`backend/api/routers/expenses.py`)

Previously returned only `year`, `week_number`, `week_start`, `week_end`. Now groups all non-deleted receipts by `(year, week_number)` and returns:

```json
{
  "year": 2025,
  "week_number": 9,
  "total": 312.50,
  "reimbursable_total": 85.00,
  "receipt_count": 4,
  "flagged_count": 0
}
```

`reimbursable_total` is the sum of `receipt.total` for every receipt where `reimbursable = true` in that week.

### Helper: `get_reimbursable()` (`expenses.py`)

Called during `POST /process-receipt` to decide whether the incoming receipt should be flagged reimbursable.

```python
def get_reimbursable(sender_name, sender_phone, settings) -> bool:
    mode = settings.get("reimbursement_mode", "all")
    if mode == "all":    return True
    if mode == "none":   return False
    if mode == "helpers_only":
        # match against comma-separated helper_identifiers
        ...
```

---

## Frontend

### Page: `frontend/app/reimbursements/page.tsx`

Route: `/reimbursements`

**Data loading** — parallel fetch on mount:
1. `GET /weeks` — all weeks with their `reimbursable_total` and `receipt_count`
2. `GET /reimbursements` — all payment records

Both responses are joined client-side to produce `WeekSummary[]`. Only weeks where `reimbursable_total > 0` are shown.

**`WeekSummary` shape (client-side):**
```ts
{
  year: number
  week_number: number
  reimbursable_total: number   // from /weeks
  receipt_count: number        // from /weeks
  paid: number                 // sum of reimbursements.amount for this week
  outstanding: number          // reimbursable_total − paid
  reimbursements: Reimbursement[]
}
```

**Outstanding calculation:**
```
outstanding = reimbursable_total − sum(reimbursement.amount for week)
```
If outstanding ≤ 0 the week is considered fully settled (overpayments count as settled).

**UI components:**

| Element | Description |
|---------|-------------|
| Summary cards | Outstanding (red) / Total paid (green) / All-time total — shown only when data exists |
| Filter tabs | All / Unpaid / Settled — counts are live from the loaded data |
| Week row | Expandable accordion; shows week number, date range, receipt count, status badge, amounts |
| Status badge | `Unpaid` (red) · `Partial` (amber) · `✓ Settled` (green) |
| Payment history | Lists each `Reimbursement` with amount, date, note, and a Remove button |
| Full payment | One-click button to mark the entire outstanding amount as paid |
| Partial payment | Number input + "Partial" button to record a custom amount |

**Actions:**

| Action | API call |
|--------|----------|
| Mark full amount paid | `POST /reimbursements` with `amount = week.outstanding` |
| Record partial payment | `POST /reimbursements` with custom `amount` |
| Remove payment | `DELETE /reimbursements/{id}` |

After every mutating action the page reloads data via `load()`.

### Navbar

`Reimburse` added to `NAV_ITEMS` in `frontend/app/components/Navbar.tsx`, between Dashboard and History. Uses `IconReimburse` (currency-circle SVG). Appears in both the desktop header and the mobile bottom nav.

---

## Settings integration

`reimbursement_mode` and `helper_identifiers` are read from the `settings` table at receipt ingestion time. They are managed via `PATCH /settings` (existing endpoint). The Settings page UI for these fields is a separate concern.

---

## Known constraints

- Outstanding is calculated client-side — there is no server-side running balance. If two admins record payments simultaneously they will each see stale data until reload.
- Reimbursements are not tied to individual receipts, only to a `(year, week_number)` pair. Adjustments to individual receipt amounts after payments are recorded are not automatically reflected.
- The `reimbursements` table has RLS disabled (`DISABLE ROW LEVEL SECURITY`) — access is enforced at the API layer via `household_id` ownership checks.
