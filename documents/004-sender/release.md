# 004 — Sender Tracking — Release

## What was built
Capture sender name and phone number from WhatsApp message. Display in receipt card and drawer. Include in weekly summary message.

## Files changed
- `backend/migrations/004_sender.sql` — added sender_name, sender_phone columns
- `backend/api/routers/expenses.py` — accept sender fields in process-receipt
- `backend/whatsapp/index.js` — extract sender from message object
- `frontend/app/dashboard/page.tsx` — show sender in card and drawer

## Database migrations
Run in Supabase SQL Editor:
- `backend/migrations/004_sender.sql`

## Known issues
- `sender_name` and `sender_phone` saving as empty — Baileys message structure may differ in group context. Debug log added, needs investigation.
