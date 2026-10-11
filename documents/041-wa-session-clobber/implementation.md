# 041 — WhatsApp session overwritten on a failed load · Implementation

## The failure

The bot stopped answering in the group. The backend logs (2026-10-11) showed the
bot alive and polling, but never connected:

```
GET  /internal/wa-auth?tenant_id=default   200   ← session loaded
POST /internal/qr                          200   ← …then a pairing QR, every ~20s
GET  /internal/qr-status                   200   (every 5s)
```

There was no `GET /internal/messages`, which only starts on `connection === "open"`,
and no `POST /internal/graph-invoke`. The bot had a stored session that WhatsApp no
longer accepted as paired, so it sat on the QR screen until someone re-scanned.

## Root cause

`backend/whatsapp/db-auth-state.js` decides between "resume a session" and "pair
from scratch" by checking whether the loaded rows include a `creds` row. Two
different situations led to the wrong answer:

1. **Failed load read as "no session".** The load ran in a `try/catch` that logged
   the error and carried on with an empty cache. An empty cache has no `creds`, so
   the code called `initAuthCreds()` and **upserted the new unpaired creds over the
   real ones**. The first `creds.update` also wrote them. The next boot then loaded
   them successfully (the `200` above) and showed a QR.

   That catch was written when the load was a direct Supabase query, which rarely
   failed. Since 040 the load goes through the backend (`/internal/wa-auth`), and
   `startSock()` reloads the session on **every** reconnect (408/428/515/
   decrypt-failure restart), not only at process boot. So a reconnect while the
   backend was redeploying, restarting, or returning 503 (`INTERNAL_KEY` unset) or
   401 (key mismatch) was enough to unpair the bot permanently. 040's own deploy,
   which needed both services redeployed with a new key requirement, is the most
   likely trigger. We can't prove that from here because the bot's own logs weren't
   available.

2. **Silent truncation by PostgREST.** `GET /internal/wa-auth` did one unbounded
   `select`. PostgREST caps every response at the project's `max-rows` (1000 by
   default) and doesn't say when it truncates. A paired bot in a few active groups
   accumulates signal sessions and sender-keys past that. With no `ORDER BY`,
   whether `creds` landed in the first 1000 rows was luck, and when it didn't, case
   1 followed. (The pre-040 direct query had the same cap.)

## The fix

- **`db-auth-state.js`**: a failed or malformed load now **throws**.
  `startSockWithRetry()` already retries a throw from `startSock()` every 5s, which
  is the right response to a backend blip. Fresh creds are minted only when the
  load *succeeded* and contained no `creds` row. A `creds` row that won't decode
  also throws instead of being overwritten (before this, it crashed inside Baileys
  anyway).
- **`api/routers/wa_auth.py`**: the load pages with `.order("key").range(...)` in
  1000-row pages until a short page comes back.

## Rejected / not done

- **Caching the session on local disk as a fallback.** Railway has no volume. That's
  why the session lives in the DB in the first place (migration 021).
- **Making `/setup/reset-qr` also wipe the stored session.** It doesn't: it ends the
  socket, and Baileys reconnects with the same creds. That's a separate question and
  out of scope here.
- **Retention for `whatsapp_auth`.** Row growth is what makes the 1000-row cap
  reachable. Pagination makes the count harmless; pruning stale signal sessions
  would be a separate change.

## Deliberate narrowness

The throw also blocks a *legitimately* first-time pairing while the backend is
unreachable. That's intended: an unpaired bot can't do anything useful without the
backend, and a QR it can't persist would be lost on the next restart anyway.
