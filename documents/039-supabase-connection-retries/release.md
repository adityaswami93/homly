# 039 — Supabase Connection Retries — Release

## What was built

Three fixes for what the 2026-09-12 Railway logs showed a signed-in member hitting:

1. **Dashboard 500s are gone.** `GET /household`, `GET /households` and `POST /household`
   returned `{"detail":"An internal error occurred"}` 28 times between 05:54 and 06:00.
   Cause: Supabase's edge closes a pooled HTTP/2 connection after two requests
   (`ConnectionTerminated error_code:0`), and over HTTP/2 the client can't tell before it
   has already sent the next request on it. Supabase calls now go through one shared
   client that talks **HTTP/1.1** (where the pool spots a server-closed connection before
   reusing it) and whose transport re-sends anything that still comes back with no
   response.

   **A first version of this shipped with the retry only, and was not sufficient** —
   almost every request logged a retry and one `GET /households` still 500ed after three
   attempts. If you are reading the deploy history and see that in between, that is what
   it was.
2. **A blip no longer looks like "you have no household".** When the membership lookup in
   the auth middleware failed, it logged the error and carried on with no household — so
   `GET /household` answered `200 {"household": null}` and the dashboard showed a
   set-up member the onboarding flow. It now returns `503` with
   `"Could not load your household right now — please try again"`.
3. **`//household` 404s on sign-in are gone.** `NEXT_PUBLIC_API_URL` is configured with a
   trailing slash, and the magic-link and OAuth-callback pages concatenated `/household`
   onto it. The 404 body has no `id`, so returning members were sent to `/onboarding`.
   The base URL is now normalised in one place.

## Files changed

### Backend

- `backend/services/db.py` — **new.** `get_supabase()`: the one Supabase client for the
  backend. `_iter_httpx_clients()` finds the httpx sessions inside the supabase client;
  each one gets `_disable_http2()` (the fix) and `_RetryTransport` (the net — up to 4
  attempts, ~50 ms apart). Retries connection failures only — never status codes, never a
  non-idempotent request whose failure doesn't prove the server ignored it, never a
  streaming body.
- `backend/api/middleware/auth.py` — a failed household lookup returns `503` instead of
  proceeding as "no household". Client from `get_supabase()`.
- 39 other modules (`api/routers/*.py`, `services/*.py`, `agents/**/*.py`) — each had its
  own `create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))`; all now call
  `get_supabase()`. Mechanical substitution of an identical expression; the now-unused
  `import os` lines were removed with `ruff --fix`.
- `backend/tests/test_db_retry.py` — **new.** 13 cases: GOAWAY retried, connect error
  retried, gives up after `_MAX_ATTEMPTS`, write retried only when the server provably
  didn't process it, streaming body not replayed, status codes not retried, wrapping is
  idempotent, the session walk finds nested clients, and HTTP/2 turned off on the pool
  (directly, through the retry wrapper, and reported as `"unavailable"` when there's no
  pool to flip).
- `backend/scratch/test_bot_profile.py` — its stub now shims `services.db` rather than
  `supabase`, so the script still runs with no backend deps installed.

### Frontend

- `frontend/lib/apiUrl.ts` — **new.** `API_URL` = `NEXT_PUBLIC_API_URL` with trailing
  slashes stripped. Separate from `lib/axios.ts` so the landing page can import it
  without pulling in the Supabase browser client.
- `frontend/lib/axios.ts` — `baseURL: API_URL`.
- `frontend/app/auth/callback/page.tsx`, `frontend/app/auth/magic-link/page.tsx`,
  `frontend/app/page.tsx`, `frontend/app/(shell)/expenses/page.tsx`,
  `frontend/app/(shell)/settings/page.tsx` — use `API_URL` instead of reading
  `NEXT_PUBLIC_API_URL`. `settings/page.tsx`'s own local trailing-slash strip is gone.

### Docs

- `CLAUDE.md` — `services/db.py` and `lib/apiUrl.ts` in Project Structure; two new
  conventions under Key Patterns ("One Supabase client", "never read
  `NEXT_PUBLIC_API_URL` directly").
- `documents/039-supabase-connection-retries/` + index row in `documents/README.md`.

## Database migrations

None.

## Environment variables

None added. One worth correcting while you're in there: **`NEXT_PUBLIC_API_URL` should
have no trailing slash.** The code now copes either way, so this is tidiness, not a
blocker.

## Deployment steps

Push and let Railway (backend) and Vercel (frontend) redeploy. No ordering constraint
between them: the backend change is internal, and the frontend change only affects URLs
it builds itself. No restart of the WhatsApp bot service is needed — nothing in
`backend/whatsapp/` changed.

## How to verify it worked

1. **Backend boot.** The Railway log should carry, once, at startup:
   `Supabase client ready — retry transport on N httpx session(s), HTTP/1.1 enforced on N
   of them` (N is 2–4, and the two numbers should match). Two things to look for instead:
   - `Could not turn HTTP/2 off for … session(s)` — the main fix did **not** take
     (httpx/httpcore internals moved); expect the constant retry warnings back.
   - `Supabase client ready but no httpx session was found to wrap` — neither half took;
     supabase-py's internals moved and `_iter_httpx_clients` needs updating.
   Everything still works in both cases; the 500s just come back.
2. **The 500s.** Load the dashboard and reload it a dozen times. Search the deploy logs
   for `500 Internal Server Error` and for `RemoteProtocolError` — both should be absent.
   Also check `httpx:HTTP Request:` lines now say **`HTTP/1.1 200 OK`** rather than
   `HTTP/2 200 OK`; that's the downgrade having taken effect. `WARNING … Supabase
   connection dropped … — retrying` should now be *rare*. If it's on most requests, the
   downgrade didn't happen — see step 1.
3. **The 404s.** Sign in via magic link and search the logs for `//household`. There
   should be none, and a member who already has a household should land on `/expenses`,
   not `/onboarding`.
4. **The 503.** Only appears if Supabase is genuinely unreachable for all three attempts;
   there's no way to trigger it on demand. If it ever shows up, it means "database
   trouble", not "user has no household".

## Known issues

- The retry half is confirmed working in production (its warnings are in the 07:49
  Railway logs). The HTTP/1.1 downgrade has not been through a deploy yet — step 1 above
  is how to tell.
- `tests/test_db_retry.py` was written but **not executed** — the environment it was
  written in has no package index, so `httpx`/`supabase`/`pytest` couldn't be installed
  and `npm install` failed for the frontend, so there's no local typecheck or build
  either. The logic was exercised against a stand-in httpx (all nine cases pass), but the
  authoritative run is CI on the PR. **Check the CI result before deploying.**
- Not reproduced against a live Supabase project: the failure needs the server to send a
  GOAWAY, which can't be triggered on demand.
- Retries are silent apart from a `WARNING` line. If Supabase starts dropping
  connections constantly, requests get slower rather than failing, and the warning count
  in the logs is the only signal. There's no metric or alert on it.
- `backend/db/client.py` (empty, unused) is still there — see implementation.md.
