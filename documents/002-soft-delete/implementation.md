# 002 — Soft Delete

## Problem
No way to remove incorrect or duplicate receipts from the dashboard without deleting from the database entirely.

## Solution
Add a `deleted` boolean column to receipts. Deleted receipts are excluded from totals and views but remain in the database for audit purposes.

## Claude Code prompt
(See session transcript.)

## Technical notes
- Views (`weekly_totals`, `weekly_category_summary`) updated to filter `WHERE deleted = false`
- Frontend removes receipt from UI immediately on delete (optimistic update)
- No restore UI yet — can be done directly in Supabase if needed
