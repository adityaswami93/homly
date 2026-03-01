# 002 — Soft Delete — Release

## What was built
Remove receipt button in the receipt drawer. Deleted receipts excluded from totals and category breakdown immediately.

## Files changed
- `backend/api/routers/expenses.py` — added `/receipts/{id}/delete` endpoint, filtered deleted from get_week
- `backend/migrations/002_soft_delete.sql` — added deleted column, updated views
- `frontend/app/dashboard/page.tsx` — delete button in drawer, optimistic UI update

## Database migrations
Run in Supabase SQL Editor:
- `backend/migrations/002_soft_delete.sql`

## Known issues
None.
