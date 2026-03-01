# 005 — Send Messages from Dashboard — Release

## What was built
"Send to group" button on dashboard. Queues a formatted week summary message. Bot picks it up within 10 seconds and posts to WhatsApp group.

## Files changed
- `backend/api/routers/messages.py` — message queue, send endpoint, message builders
- `backend/api/main.py` — registered messages router
- `backend/whatsapp/index.js` — polls message queue every 10s
- `frontend/app/dashboard/page.tsx` — send to group button

## Known issues
- Queue is in-memory — messages lost if backend restarts before bot picks them up. Acceptable for now, can move to Supabase table later.
