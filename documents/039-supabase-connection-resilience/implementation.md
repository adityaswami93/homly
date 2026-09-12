# 039 — Transient Supabase connection faults — Implementation

## The failure, concretely

Production logs, repeatedly, on an otherwise healthy database:

```
ERROR:api.middleware.auth:Failed to fetch household for user 01e4343f-…: <ConnectionTerminated error_code:0, last_stream_id:3, additional_data:None>
INFO:     100.64.0.12:55796 - "GET /household HTTP/1.1" 200 OK
ERROR:api.middleware.auth:Failed to fetch household for user 01e4343f-…: Server disconnected
INFO:     100.64.0.15:42032 - "GET /household HTTP/1.1" 200 OK
```

and, for the same fault landing one layer further in, a raw traceback out of
`api/routers/households.py`'s `get_my_household`:

```
  File "/app/api/routers/households.py", line 119, in get_my_household
  …
httpx.RemoteProtocolError: <ConnectionTerminated error_code:0, last_stream_id:3, additional_data:None>
```

Note the pairing in the first block: an `ERROR` saying the household lookup
failed, immediately followed by **`200 OK`** for the request that depended on
it. That is the user-visible bug. The middleware caught the exception, logged
it, and left `household_id = None`, which is indistinguishable from "this user
isn't in a household yet". `GET /household` then answered
`200 {"household": null}`, and the dashboard acted on that answer:

* `frontend/app/login/page.tsx` — `res.data?.id ? "/expenses" : "/onboarding"`
* `frontend/app/(shell)/expenses/page.tsx` — `if (!res.data?.id) router.push("/onboarding")`,
  **and** `catch { router.push("/onboarding") }`
* `frontend/app/auth/callback`, `frontend/app/auth/magic-link` — same check over raw
  `fetch`, with no `res.ok` guard, so a `{"detail": …}` error body also reads as
  "no household"

So an existing household member, mid-session, gets bounced to "create your
household", where the obvious next click makes a **second** household. A
transient network blip became a data-shaped problem.

## Root cause

`services/supabase_client.py`'s module docstring holds the full explanation; in
short: supabase-py's postgrest/auth/storage clients are built with `http2=True`,
Supabase's edge closes connections on its own schedule, and a graceful HTTP/2
shutdown arriving mid-request surfaces as
`httpx.RemoteProtocolError(<ConnectionTerminated error_code:0 …>)` — `error_code:0`
is NO_ERROR. On HTTP/1.1 the same race reads
`Server disconnected without sending a response`. Both are in the logs above.

Nothing in this backend retried anything. Each of the ~40 modules called
`create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))` for
itself, so there was no single place where a retry *could* be added, and no
single connection pool either.

The second half of the root cause is the middleware's `except Exception` — a
lookup that failed and a user with no memberships were collapsed into the same
`household_id = None`.

## Approach

Three layers, in the order a request meets them:

1. **`backend/services/supabase_client.py` (new).** One process-wide client,
   built on one `httpx.Client` whose transport is a `RetryTransport` wrapper.
   All 40 modules now call `get_supabase()`.
2. **`api/middleware/auth.py`.** A failed membership lookup returns
   `503 {"detail": "Could not reach the database. Please try again."}` instead of
   falling through as "no household".
3. **Frontend.** Only a *definite* answer routes to `/onboarding`: a 2xx with no
   `id`, or a 404. Anything else shows an error and stays put.

`api/routers/households.py`'s `get_my_household` also stopped indexing
`household.data[0]` unconditionally — a membership row pointing at a deleted
household was a 500 with a traceback; it now answers like "no household".

### Why retry at the transport layer

The alternative was a helper — `execute_with_retry(builder)` — called at each
query site. Rejected: there are hundreds of `.execute()` calls, every new one
would have to remember to opt in, and the ones that forgot would be exactly the
rarely-exercised paths where a silent failure hurts most. A transport wrapper
covers every current and future Supabase call by construction, including the
ones inside supabase-py itself (`auth.admin.list_users()`).

supabase-py 2.28.0 supports this directly: `ClientOptions(httpx_client=…)` is
handed to the postgrest, auth, storage and functions clients
(`supabase/_sync/client.py`), all of which build absolute URLs and per-request
headers, so sharing one client between them is safe — upstream even tests it
(`test_httpx_client_base_url_isolation`, supabase-py issue #1244).

### What is deliberately *not* retried

This is the part worth reading before widening anything:

* **Non-idempotent methods on a mid-flight fault.** `Server disconnected without
  sending a response` does not prove the write didn't land — only that we never
  saw the answer. Replaying a POST could mean two receipts, two reimbursement
  rows, two chore logs. POST/PATCH/PUT/DELETE are retried *only* on
  connect-level faults (`ConnectError`, `ConnectTimeout`, `PoolTimeout`), where
  the request provably never left the process. GET/HEAD/OPTIONS are retried on
  both classes.
* **Read/write timeouts.** A slow query retried three times triples the load on
  a database that is already struggling, and it may have been applied anyway.
* **HTTP error statuses.** A 500 or 429 from PostgREST comes back as a
  *response*, not an exception; interpreting it is the caller's business. (A
  future targeted 429/backoff policy would be a separate change.)
* **Requests whose body is a one-shot stream** (a receipt image upload) — the
  body is already consumed, so a replay would send a truncated one.

### The approach that looked obvious and was wrong

**"Just lower `keepalive_expiry` so we never reuse a stale connection."** httpx
already expires idle pooled connections after 5 seconds. The GOAWAY in the log
is not a long-idle connection being reused hours later; it is the server
closing while a request is in flight (`last_stream_id:3` — streams above that
were never processed). No timeout value prevents that race; only re-sending
does. Don't replace the retry with keepalive tuning.

**"Catch the exception in the middleware and carry on."** That *was* the code,
and it is what turned a network blip into "you have no household". A lookup
that failed is not an answer about the user's data — the only honest options
are retry or fail loudly, and this change does both, in that order.

### Deliberate narrowness

* `_ATTEMPTS = 3` (one original + two retries). The GOAWAY race resolves on the
  first retry, because the dead connection is no longer in the pool. More
  attempts would only extend the latency of a genuinely unreachable database.
* The 120s total timeout matches postgrest-py's own default, so adopting the
  shared client doesn't quietly tighten timeouts on existing queries. The
  connect phase is capped at 10s — a connect that slow is a dead host, not a
  slow query.
* Passing an explicit `transport=` disables httpx's env-proxy handling
  (`allow_env_proxies = trust_env and transport is None`), so `_env_proxy()`
  re-reads `HTTPS_PROXY`/`ALL_PROXY` and honours `NO_PROXY` as plain host-suffix
  matching. That is deliberately less than httpx's full implementation: there is
  exactly one target host here. If the backend ever calls a second host through
  this client, revisit it.

## What was left out

* **The per-module `_db()`/`_get_supabase()` wrappers stayed.** They now cache
  the shared singleton instead of building their own client, which is harmless.
  Collapsing them to direct `get_supabase()` calls is a tidy-up worth doing in a
  quiet moment, not while also changing connection behaviour.
* **429/rate-limit backoff.** Not touched, see above.
* **Other 200-that-means-failure paths.** This change fixes the household
  lookup, which is the one with a destructive follow-on (duplicate household).
  Other routers still have `except Exception` blocks that degrade to an empty
  result — mostly reasonable for a read, but worth auditing.
* **The frontend's remaining `/household` callers**
  (`settings/page.tsx`, `chores/leave/page.tsx`) don't redirect on failure, so
  they were left alone.
* **The WhatsApp bot's own HTTP calls** to this backend (Node/axios) have no
  retry either. Out of scope; the bot's polling loop retries by nature.

## Verification

Honest account of what ran where.

**Ran, locally:** `backend/tests/test_supabase_retry.py` — 12 cases, all passing
against real httpx 0.28.1. This sandbox has no package index, so httpx and its
transitive dependencies were assembled from their upstream git tags to run them,
and `supabase`/`dotenv` were stubbed for the import (the retry rules touch
neither). Also verified end-to-end through a real `httpx.Client` that a GET to a
refused port is attempted 3 times before `ConnectError` surfaces, and that
`client._transport` is the `RetryTransport`.

Also ran: `python -m compileall backend` (clean) and
`backend/scratch/test_bot_profile.py` (passes — its `supabase` module stub had to
become a `services.supabase_client` stub).

**Not run:** `pytest tests/` as a whole, `ruff check .`, and the frontend's
`tsc`/`eslint`/`next build` — neither pytest, ruff nor npm packages are
installable in this sandbox (no package index). The mechanical part of the
change (import + call-site swap across 40 files) was checked by script: no
`create_client` left outside the new module, and no `import os` left unused (a
ruff `F401` would have failed CI on those).

**Not verified anywhere:** the retry firing against a real Supabase GOAWAY. That
needs production traffic. The check after deploy is in `release.md`.
