# 039 — Supabase Connection Retries (dashboard 500s)

## Problem

A logged-in member loading the dashboard got:

> `{"detail":"An internal error occurred"}`

28 times in one seven-minute window (Railway deployment logs, 2026-09-12, 05:54:16 →
05:59:54): 25 on `GET /household`, 2 on `POST /household`, 1 on `GET /households`. Every
one of them was the same exception:

```
httpx.RemoteProtocolError: <ConnectionTerminated error_code:0, last_stream_id:3, additional_data:None>
  File "/app/api/routers/households.py", line 119, in get_my_household
```

Alongside them, 27 log lines from the auth middleware:

```
ERROR:api.middleware.auth:Failed to fetch household for user 01e4343f-…: <ConnectionTerminated …>
INFO: "GET /household HTTP/1.1" 200 OK
```

— a 200 whose body said the user has no household.

### Root cause

`ConnectionTerminated error_code:0` is an HTTP/2 GOAWAY: Supabase's edge closing a
pooled connection *gracefully*. `last_stream_id:3` is the server saying "I processed
streams 1 and 3 and nothing after". All 114 occurrences of that frame in the log carry
exactly those values, so the shape is consistent: the server serves two requests on a
connection and then says goodbye. httpx has no way to learn that until it puts a third
request on the wire, and httpcore then raises `RemoteProtocolError` for it — before any
response headers exist.

That maps precisely onto which endpoints broke. The bot's pollers
(`/internal/messages`, `/internal/qr-status`) never touch Supabase, and
`/internal/reminders/due` makes exactly one query per minute — none of them ever failed
in this window. `GET /household` makes three Supabase calls back to back (the
middleware's `household_members` lookup, then `households`, then `household_members`
again at `households.py:119`) and the third is the one that landed on the dead
connection. The log confirms it: two `HTTP/2 200 OK` lines from httpx, then the
traceback.

Nothing was wrong with the query, the data, the JWT or the database. It was a client-side
connection-reuse assumption, and it had 40 places to go wrong: every router, service and
agent built its own `create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))`
at import, each with its own httpx connection pool.

### The second failure, in the middleware

The `except Exception` in `api/middleware/auth.py` logged the error and let the request
continue with `household_id = None`. That is not a safe default: it is indistinguishable
from "this user has genuinely joined no household". `GET /household` then answered
`{"household": null}` with a 200, which the frontend reads as *not onboarded yet* — so a
fully set-up member could be dropped into the onboarding flow because of a transient
connection blip. That is the 27 lines above, and it is worse than the 500s, because
nothing about it looks like a failure to the user.

### A third thing the logs showed

Three `GET //household → 404` (05:54:13, 05:59:44, 05:59:49). `NEXT_PUBLIC_API_URL` is
configured with a trailing slash on at least one deploy, and the two auth pages build
`` `${process.env.NEXT_PUBLIC_API_URL}/household` `` by hand. The 404 body has no `id`,
so the sign-in check read it as "no household" and routed a returning member to
`/onboarding` — the same wrong destination as the middleware bug, by a different road.
`app/(shell)/settings/page.tsx` already carried a local `.replace(/\/+$/, "")` with a
comment explaining the trailing slash, so this was known and fixed in exactly one place.

## Solution

**`backend/services/db.py` — one client, off HTTP/2, retried.** `get_supabase()` is now
the only place in the backend that calls `create_client()`. It builds the client once,
takes each httpx session it owns down to HTTP/1.1 (`_disable_http2`), and wraps each
session's transport in `_RetryTransport`, which re-sends a request that came back with
no response at all.

The first version of this shipped with **only** the retry, and that was not enough — see
"What the first deploy proved" below. The HTTP/1.1 downgrade is the fix; the retry is the
net under it.

**`api/middleware/auth.py` — 503, not a silent empty household.** A failed membership
lookup now returns `503 Could not load your household right now`. A lookup that *failed*
is not a lookup that came back *empty*.

**`frontend/lib/apiUrl.ts` — `API_URL`, normalised once.** Exported, trailing slashes
stripped, used as the axios `baseURL` and imported by the five places that build a URL by
hand.

### What the first deploy proved (read this before "simplifying" it back)

The retry-only version went to Railway and worked exactly as designed — and the logs
looked *worse*:

```
WARNING:services.db:Supabase connection dropped on GET …/reminders?… (attempt 1/3): <ConnectionTerminated …> — retrying
WARNING:services.db:Supabase connection dropped on GET …/households?… (attempt 1/3): <ConnectionTerminated …> — retrying
WARNING:services.db:Supabase connection dropped on GET …/household_members?… (attempt 2/3): <ConnectionTerminated …> — retrying
ERROR:api.main:Unhandled error on GET /households: <ConnectionTerminated …>
INFO:     "GET /households HTTP/1.1" 500 Internal Server Error
```

Nearly every request now logged a retry, and one `GET /households` burned all three
attempts and 500ed anyway. Two things were going on:

- **Consolidating the pools raised the exposure.** 40 half-idle pools meant most requests
  went out on a *fresh* connection (stream 1) and never reached the third stream. One
  shared pool means almost every request is on a reused connection, so almost every third
  one meets the GOAWAY. The consolidation is still right — but it turned a rare failure
  into a constant one, which the retry was then papering over on every single request.
- **A retry cannot fix a client that can't see the problem.** This was the wrong
  assumption in the first version, written into `_RetryTransport`'s docstring as fact:
  that a fresh connection is all it takes. It is — but the *next* request lands on a
  connection that is two streams old and about to be refused, and nothing checks for
  that. httpcore's `HTTP11Connection.has_expired()` asks whether the idle socket has gone
  readable (a server that hung up is spotted before a request is written to it) and
  honours `Connection: close`; `HTTP2Connection.has_expired()` only compares the
  keep-alive clock, because a GOAWAY frame sitting unread in the socket buffer is
  invisible until something writes a request and then reads.

Hence `_disable_http2()`: flip `_pool._http2` off before the first request, and the pool
can see the close coming. **Don't put HTTP/2 back to "let the retry handle it".** That is
what the first version did, and this section is what it cost.

### What is deliberately narrow

- **Only connection-level failures are retried.** A 4xx or 5xx from PostgREST is an
  answer, and the caller's own error handling owns it. This module never looks at status
  codes.
- **Writes are retried only when the failure proves nothing was written** — a connect
  error (the bytes never left) or a graceful GOAWAY (the server named the last stream it
  processed). Any other error on a `POST`/`PATCH`/`DELETE` is raised as-is, because a
  successful insert whose *response* was lost would become a duplicate row on retry, and
  a duplicate receipt is worse than the 500 this fixes.
- **Streaming bodies are never replayed** (`_is_replayable`) — a receipt image on its way
  to Supabase Storage has a one-shot body iterator.
- **Four attempts, ~50 ms apart.** Three wasn't enough: a real `GET /households`
  exhausted three in production (07:49) while every connection was still HTTP/2. An
  attempt costs no round trip — the connection is already dead when we find out — but the
  ladder stays short, because these requests sit inside a user-facing one and a long
  ladder just turns a fast 500 into a slow one.
- **HTTP/2 is disabled on the Supabase sessions only.** Nothing else in the backend is
  touched: the OpenRouter/LLM clients keep whatever they negotiate. And it is disabled by
  flipping the pool's flag rather than by replacing the transport, so whatever TLS
  context, proxy or limits supabase-py configured survive.

### The approach that looked obvious and was wrong

**Passing a pre-built httpx client into `create_client()` via `ClientOptions(httpx_client=…)`.**
That is the documented injection point and it would be much cleaner than reaching into
the client after the fact. It was rejected because the deployed version (`supabase==2.28.0`)
could not be installed in the environment this was written in (no package-index access),
so whether that kwarg exists — and whether one client object can be shared across the
postgrest/auth/storage sub-clients, which each set their own base URL — could not be
verified. A wrong kwarg there is an import-time crash of the whole backend. Wrapping the
transports of the clients supabase-py has already built cannot fail that way: worst case
the walk finds nothing, `get_supabase()` logs a warning, and behaviour is exactly what it
is today. **If you are here to tidy this up:** confirm the kwarg against the pinned
version first, and keep `tests/test_db_retry.py` passing.

**Tuning `keepalive_expiry` so idle connections are dropped before the server kills
them.** Doesn't apply: httpx's default expiry is already 5 s, and the failing requests
were *milliseconds* apart (05:54:16.069 succeeded, 05:54:16.073 failed). The connection
wasn't idle — the server had simply finished with it.

**Retrying inside the callers.** There are several hundred `.execute()` calls across 40
modules. Any fix that has to be remembered at a call site is a fix that will be missing
from the next call site.

### Why the whole 40-module sweep, and not just `households.py`

The 500s happened to land on `/household` because that handler makes three Supabase
calls in a row; `/expenses`, `/tasks` and the weekly-summary job make more. Fixing the
one endpoint in the traceback would have left the same bug everywhere else, and left 40
copies of the constructor for the next person to have an opinion about. Substituting
`get_supabase()` for an identical expression in 40 files is a mechanical change that
`ruff` and `compileall` can check; leaving them is a standing invitation for the retry
policy to be true of some queries and not others.

## Technical notes

- **Finding the httpx sessions.** `_iter_httpx_clients()` walks `__dict__`s (bounded to
  depth 4, deduped by `id`, skipping modules/classes/callables) instead of naming
  `postgrest.session` / `auth._http_client`. Those paths have moved between supabase-py
  versions, and a pinned name that stops resolving turns the retries off *silently*. The
  walk is preceded by touching `auth`/`postgrest`/`storage`/`functions`, which
  supabase-py builds lazily — without that it would inspect a client whose sessions don't
  exist yet. If it ever finds nothing, `get_supabase()` logs a warning saying exactly
  that.
- **`_pool._http2` is a private httpcore attribute** reached through httpx's private
  `_transport`. It is flipped at hardening time, before the first request, while the pool
  is still empty — connections already open would keep whatever protocol they negotiated.
  If either name disappears, `_disable_http2()` returns `"unavailable"`, `get_supabase()`
  logs a warning naming it, and the retries carry the load alone.
- **`_transport` / `_mounts` are private httpx attributes.** httpx offers no public hook
  for re-wrapping a client it didn't construct. They have been the storage for a
  `Client`'s transports since httpx 0.20, and this code only reads and wraps what it
  finds. If a future httpx renames them, `test_install_retries_wraps_a_client_once` fails
  in CI.
- **Matching the GOAWAY on a string.** `httpx` flattens h2's `ConnectionTerminated` event
  into the exception *message* on the httpcore→httpx boundary; the structured event does
  not survive. So `_server_never_processed_it()` matches `"ConnectionTerminated"` in
  `str(exc)`. A miss is not a correctness problem — the request just isn't retried, which
  is today's behaviour.
- **One pool now, not 40.** All callers share one `httpx` pool (httpx defaults: 100
  connections, 20 keep-alive). `httpx.Client` is thread-safe and PostgREST query builders
  are created per call, so the scheduler threads and FastAPI's sync-endpoint threadpool
  can share it. Nothing in this codebase mutates client-level auth state (no
  `postgrest.auth()` / `set_session()` call exists) — if that ever changes, per-request
  state on a shared client is the thing to think about first.

## Verification

**Verified.** `ruff check .` clean (it was clean before, and 31 `import os` lines that
became unused were removed), `python -m compileall` clean,
`python tests/check_household_scoping.py` reports the same findings as before the change
(line numbers shifted by the removed imports; the allowlist is empty, so nothing went
stale), and `python scratch/test_bot_profile.py` passes.

**Not verified, and why.** The environment this was written in has no package-index
access, so `httpx`, `supabase` and `pytest` could not be installed and
`tests/test_db_retry.py` **has not been run against the real httpx** — nor has the
frontend been typechecked or built (`npm install` is blocked the same way). What was done
instead: the same nine cases were run against a hand-written stand-in for the parts of
httpx this code touches (`Client`, `BaseTransport`, `Request.content` raising
`RequestNotRead` for streaming bodies, the five exception types), and all nine pass —
that exercises the control flow in `services/db.py`, not httpx's real behaviour. CI runs
`tests/test_db_retry.py` against the real library on the PR; treat that, not this
paragraph, as the confirmation.

**Verified in production, for the retry half.** The retry-only version was deployed and
its logs are quoted above: the warnings prove `_iter_httpx_clients` found the sessions,
that the wrap took, and that retries fire and mostly succeed. That is also what showed
the retry alone to be insufficient. The HTTP/1.1 downgrade has *not* been through a
deploy at the time of writing — the startup log line (below, in release.md) is how to
confirm it took.

Nothing here was tested against a live Supabase project locally. The failure needs the
server to send a GOAWAY, which isn't reproducible on demand.

## What was left out

- **`backend/db/client.py`** is an empty, untouched, unimported file — an abandoned
  earlier attempt at this same idea. Left alone rather than deleted in a bug-fix change;
  delete it whenever you're next in there, so it doesn't get confused with
  `services/db.py`.
- **The lazy `_db()` wrappers** (`global _supabase; if _supabase is None: …`) are now
  redundant, since `get_supabase()` caches. They were left in place to keep this diff a
  one-line substitution per module.
- **Async Supabase clients.** `_iter_httpx_clients` only wraps `httpx.Client`. Nothing in
  the backend uses `acreate_client`; if that changes, `httpx.AsyncClient` needs the same
  treatment with an async transport.
- **The 307 on `POST /mcp/server/<key>`** also in these logs is expected — it's the
  trailing-slash redirect already documented in `CLAUDE.md`.
