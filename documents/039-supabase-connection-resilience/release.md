# 039 — Transient Supabase connection faults — Release

## What changed for the user

* **The dashboard no longer forgets your household.** A transient Supabase
  connection drop used to make `GET /household` answer `200 {"household": null}`,
  which sent an existing member to `/onboarding` ("create your household") — one
  click from creating a duplicate household. Those faults are now retried, and if
  the database really is unreachable the page says so instead of pretending you
  have no household.
* **Fewer 500s with raw tracebacks.** The same connection fault hitting a
  router's own query used to surface as a 500. The retry covers those too.
* **No behaviour change when everything is healthy.** Same queries, same
  timeouts, same responses.

Under the hood: every Supabase call in the backend now goes through one shared,
retry-hardened client instead of ~40 independently created ones.

## Files touched

**New**

* `backend/services/supabase_client.py` — `get_supabase()` (the shared client) and
  `RetryTransport` (the httpx transport that replays a lost request). The module
  docstring is the reference for *what is and isn't retried, and why*.
* `backend/tests/test_supabase_retry.py` — 12 cases covering the retry rules.
* `documents/039-supabase-connection-resilience/` — this folder.

**Changed — behaviour**

* `backend/api/middleware/auth.py` — a failed membership lookup now returns
  `503 {"detail": "Could not reach the database. Please try again."}` instead of
  continuing with `household_id = None`. The error log line now includes the
  exception type.
* `backend/api/routers/households.py` — `GET /household` answers
  `{"household": null}` when the membership row points at a household that no
  longer exists, instead of raising `IndexError` (a 500).
* `frontend/app/(shell)/expenses/page.tsx`,
  `frontend/app/(shell)/expenses/members/page.tsx` — redirect to `/onboarding`
  only on a 404; any other failure shows a toast and stays put.
* `frontend/app/auth/callback/page.tsx`, `frontend/app/auth/magic-link/page.tsx` —
  check `res.ok` before reading the body, so an error body isn't read as
  "no household".

**Changed — mechanical** (`create_client(...)` → `get_supabase()`, plus the
now-unused `import os` removed)

* `backend/api/middleware/auth.py`, and the 22 routers under
  `backend/api/routers/` that talked to Supabase
* `backend/agents/homly_graph.py` (3 sites), `backend/agents/orchestrator/supervisor.py`,
  and all 7 `backend/agents/query/*_agent.py` that hold their own client
* `backend/services/{bot_profile,conversation,mcp_queries,pantry_confirmations,preferences,proactive_notifications,receipt_service,whatsapp_scheduler}.py`
* `backend/scratch/test_bot_profile.py` — its module stub now stubs
  `services.supabase_client` rather than `supabase`

## Migrations to run

**None.** No schema change.

## Env vars

**No new ones.** `SUPABASE_URL` / `SUPABASE_KEY` are read exactly as before.

Two existing environment variables now affect Supabase calls where they
previously didn't, because passing httpx an explicit transport turns off its own
environment-proxy handling and this module re-reads them: `HTTPS_PROXY` /
`ALL_PROXY` (honoured) and `NO_PROXY` (honoured, as host-suffix matching). Neither
is set on Railway today, so this is a no-op there — but if you add a proxy to the
backend's environment, check it still reaches Supabase.

## Deploy order

1. **Backend (Railway)** first. It is self-contained: no migration, no schema
   dependency, and the API contract only *gains* a 503 where it previously lied
   with a 200.
2. **Frontend (Vercel)** second. The frontend change is what stops a 503 from
   still bouncing a member to `/onboarding`, so deploying it after the backend
   means the 503 is already available to it.

Old frontend + new backend (the window between the two) is safe: the old
`/expenses` page's `catch` sends the user to `/onboarding` on a 503 — the same
behaviour it had before this change, no worse.

## How to verify it worked

1. **Nothing regressed.** Sign in, load `/expenses`, `/expenses/members`,
   `/settings`, `/chores`. Send a WhatsApp message the bot answers, and upload a
   receipt. All of these now go through the shared client — a wiring mistake
   would show up immediately as a 500, not subtly.
2. **The retry is firing.** Search backend logs for `[supabase]`. A successful
   retry logs, once, at WARNING:

   ```
   [supabase] GET /rest/v1/household_members failed with RemoteProtocolError: <ConnectionTerminated error_code:0, …> — retrying in 0.25s (attempt 2/3)
   ```

   and nothing else — no `Failed to fetch household for user …` next to a
   `200 OK` for `/household`. That pairing was the bug; its absence is the fix.
   Seeing zero `[supabase]` lines over a day is also fine: it means no faults
   occurred.
3. **A real outage still fails loudly.** If `Failed to fetch household for user`
   *does* appear, the request it belongs to should now be a `503`, not a `200`.
4. **The h2 line.** `[supabase] h2 not installed — using HTTP/1.1` at startup
   means HTTP/2 is off (it works, just without multiplexing). `h2` arrives
   transitively today; if that line appears and you want HTTP/2 back, add
   `httpx[http2]` to `backend/requirements.txt`.

## Known issues / limitations

* **A retried GET is slower, not faster.** A fault costs an extra 0.25s (then
  0.5s) before the request succeeds. That is the trade for not failing.
* **Writes still surface mid-flight faults.** A POST/PATCH/DELETE interrupted
  after the request was sent is *not* retried, deliberately — see
  `implementation.md`. The dashboard will show an error and the user retries; a
  silent duplicate receipt or reimbursement would be worse.
* **Rate limits (429) are untouched.** They come back as responses, not
  exceptions, and are passed through to callers as before.
* **One shared connection pool** now serves the whole process (httpx defaults:
  100 connections, 20 keep-alive). Previously each module had its own. This is
  strictly less socket churn, but it is a single point to look at if connection
  exhaustion ever shows up under load.
* **The retry has not been observed against a real Supabase GOAWAY** — only
  against synthesised faults in tests and a refused local port. Step 2 above is
  how you confirm it in production.
