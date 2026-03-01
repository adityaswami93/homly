# 003 — Settings — Release

## What was built
Settings page with configurable summary day, time, timezone, cutoff mode, and group name. Bot auto-reschedules on settings change.

## Files changed
- `backend/api/routers/settings.py` — get/patch settings endpoints
- `backend/api/routers/internal.py` — `/internal/settings` for bot
- `backend/migrations/003_settings.sql` — settings table
- `backend/whatsapp/index.js` — dynamic cron scheduling, settings polling
- `frontend/app/settings/page.tsx` — settings UI
- `frontend/app/components/Navbar.tsx` — added Settings nav item

## Database migrations
Run in Supabase SQL Editor:
- `backend/migrations/003_settings.sql`

## Known issues
None.
