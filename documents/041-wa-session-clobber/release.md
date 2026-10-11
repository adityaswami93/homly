# 041 — WhatsApp session overwritten on a failed load · Release notes

**Type:** bug fix · **Breaking:** no

## What changed for the user

Nothing visible. The bot no longer unpairs itself when it reconnects while the
backend is briefly unavailable. Instead it logs
`[auth] Failed to load auth state: …` / `startSock failed … retrying in 5s` and
resumes once the backend answers.

**This does not reconnect a bot that is already unpaired.** A household admin
must re-scan once: dashboard → `/setup` → Generate QR → scan from the WhatsApp
account the bot runs on (Linked devices → Link a device).

## Files

- `backend/whatsapp/db-auth-state.js` — throw on a failed or malformed load instead of minting fresh creds
- `backend/api/routers/wa_auth.py` — page the session load past PostgREST's 1000-row cap
- `backend/tests/test_wa_auth_load.py` — pagination tests

## Migrations / env vars

None. Check that `INTERNAL_KEY` is set and identical on the backend and bot
services. If it isn't, the bot now retries every 5s with a 401/503 in its log
instead of showing a QR.

## Deploy order

Backend first, then the bot. Either order is safe.

## Verify

1. After deploy, re-scan the QR once. The backend log should show
   `GET /internal/messages` polling and the bot log `[bot] Connected!`.
2. Restart the backend service while the bot is running. The bot may log load
   failures, but must come back **without** a new `POST /internal/qr`.

## How this was tested

The backend deps couldn't be installed here (no package index reachable), so
`pytest` didn't run. Instead:

- The pagination tests in `test_wa_auth_load.py` were run with `fastapi`,
  `pydantic` and `services.*` stubbed out. All 3 pass.
- `db-auth-state.js` was exercised with a stubbed `baileys` and a fake `api`
  client covering four cases: backend error → throws, zero writes; paired creds →
  loaded, zero writes; empty tenant → fresh creds written once; corrupt creds →
  throws, zero writes.

It wasn't run against a live WhatsApp connection.

## Known issues

`/setup/reset-qr` ends the socket but doesn't clear stored creds. See implementation.md.
