# 009 — QR Reset & Bot Auth Refactor — Release

## What was built

1. **Working QR regeneration** — users can now regenerate the WhatsApp QR code from the setup page at any time (expired QR, bot restart, etc.) without touching Railway or restarting services.
2. **Bot auth via service role key** — removed the short-lived JWT + refresh token from the bot; it now authenticates with the Supabase service role key which never expires.

## Files changed

- `backend/api/routers/setup.py` — added `qr_requested` flag to `whatsapp_state`; `POST /setup/reset-qr` now sets both `qr = None` and `qr_requested = True`
- `backend/api/routers/internal.py` — added `GET /internal/qr-status`: returns `{"qr_requested": bool}` and clears the flag atomically
- `backend/api/middleware/auth.py`
  - Added `/internal/qr-status` and `/setup/reset-qr` to `SKIP_AUTH_PATHS`
  - Service key path no longer looks up `HOMLY_USER_ID`; sets `household_id: None, is_service_key: True`
- `backend/whatsapp/index.js`
  - Removed `HOMLY_TOKEN`, `SUPABASE_REFRESH_TOKEN`, `HOMLY_USER_ID`, `refreshToken()`, 45-minute refresh interval
  - Added `SERVICE_KEY = process.env.SUPABASE_KEY` — used as bearer for all backend API calls
  - Added module-level `currentSock = null` — assigned immediately after `makeWASocket()`
  - Added 5-second global polling loop: calls `GET /internal/qr-status`, triggers `currentSock.end()` when flag is set
- `frontend/app/setup/page.tsx` — "Generate QR code" button shown in spinner state; "QR expired? Generate a new one" shown when QR is displayed; both call `POST /setup/reset-qr`

## Database migrations

None.

## Environment variables

**Removed** from `backend/whatsapp/.env`:
```
HOMLY_TOKEN=...            # no longer needed
SUPABASE_REFRESH_TOKEN=... # no longer needed
HOMLY_USER_ID=...          # no longer needed (bot uses service key; household resolved from groupMap)
```

**Still required** in `backend/whatsapp/.env`:
```
FASTAPI_URL=...
SUPABASE_KEY=...    # Supabase service role key — used as the bot's auth token
INTERNAL_KEY=...    # Shared secret for /internal/* endpoints
```

**Still required** in `backend/.env`:
```
SUPABASE_URL=...
SUPABASE_KEY=...
INTERNAL_KEY=...
OPENROUTER_API_KEY=...
```

## Deployment steps

1. Update Railway env vars for the WhatsApp bot service — remove `HOMLY_TOKEN`, `SUPABASE_REFRESH_TOKEN`, `HOMLY_USER_ID`; confirm `SUPABASE_KEY` is set to the service role key
2. Redeploy both the FastAPI service and the WhatsApp bot service on Railway
3. The bot will reconnect and push a QR to the backend — scan via the setup page or Railway logs

## Known issues

- `whatsapp_state` (including `qr_requested`) lives in-memory in the FastAPI process. If Railway restarts the backend between the user clicking "Generate QR" and the bot polling `qr-status`, the flag is lost and the bot won't reconnect. The workaround is to click the button again. Moving the flag to a DB row would fix this permanently.
