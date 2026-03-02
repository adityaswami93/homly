# 009 — QR Reset & Bot Auth Refactor

## Problem

Two related problems discovered in the same session:

1. **QR reset not working.** The setup page had a "Generate QR code" button that called `POST /setup/reset-qr`, which cleared the backend's QR state — but did nothing to the bot. The bot kept its existing Baileys socket alive, so no new QR was ever generated. Users were stuck with a spinner and no way to recover.

2. **Bot token expiry.** The WhatsApp bot was authenticating with a Supabase JWT access token (`HOMLY_TOKEN`) loaded from `.env` at startup. JWTs expire after ~1 hour. The bot had a 45-minute refresh interval, but it only started *after* the first connection, meaning tokens loaded from file could already be near-expiry. When a token expired mid-session, receipt processing silently failed with a 401.

## Solution

### QR reset — end-to-end signalling

The fix required a signalling channel between the frontend, backend, and bot:

1. `POST /setup/reset-qr` sets `whatsapp_state["qr_requested"] = True` (in addition to clearing `qr`)
2. A new `GET /internal/qr-status` endpoint returns the flag and clears it atomically
3. The bot polls this endpoint every 5 seconds
4. When the flag is set, the bot calls `currentSock.end()` — this closes the Baileys socket cleanly
5. Baileys' auto-reconnect fires, generates a new QR, and the bot pushes it to `POST /internal/qr`
6. The frontend's existing 3-second poll to `/setup/state` picks up the new QR

The `currentSock` module-level variable holds a reference to the active socket so the poller can reach it from outside the `startSock()` function.

### Bot auth — service role key

Replaced `HOMLY_TOKEN` (short-lived JWT) with `SUPABASE_KEY` (service role key). Service keys never expire, so no refresh logic is needed. The auth middleware was updated to detect the service key and set `is_service_key: True` on `request.state.user`, with `household_id` left as `None` (resolved from the request body/query instead).

## Technical notes

- `whatsapp_state` is an in-memory dict in `setup.py`, imported by `internal.py`. Both routers run in the same FastAPI process so this works fine. If the processes were ever split, this would need to move to Redis or a DB row.
- `currentSock.end(new Error("QR reset requested"))` triggers Baileys' `connection.update` with `lastDisconnect.error` set, which causes the reconnect loop to restart normally.
- The 5-second poll interval was chosen to keep latency low. At scale this could be replaced with a Redis pub/sub.
- `GET /internal/qr-status` clears the flag in the same request to avoid double-triggering if the bot polls again before reconnecting.
- Both `/internal/qr-status` and `/setup/reset-qr` are in `SKIP_AUTH_PATHS` — the former uses `X-Internal-Key`, the latter is called directly from the setup page without a user session.
