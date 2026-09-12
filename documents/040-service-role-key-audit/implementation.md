# 040 — Service role key audit: privilege escalation, unauthenticated endpoints, credential blast radius

## What prompted this

A review of every use of the Supabase **service role key** (`SUPABASE_KEY`) and
of the credentials sitting next to it. That key bypasses Row Level Security on
every table in the project, and — per `CLAUDE.md` — RLS is explicitly
*disabled* on most tables anyway, so application-level `household_id` filtering
is the only thing separating tenants. Anything that widens who can reach a
service-role query is a cross-household data leak by default.

The key itself turned out to be handled correctly in the places people usually
get wrong: it never reaches the browser (`frontend/lib/supabase.ts` uses only
the anon key, and no Next.js route handler touches the service key), no `.env`
is committed, and every `.update()`/`.delete()` in `api/routers/` does a
check-then-write ownership verification first. `api/routers/mcp_data.py` is
genuinely well built — the key *is* the household, so there is no
`household_id` parameter to spoof.

What was wrong was everything *around* it: who could reach service-role
queries, and which processes held the key.

## The failures, concretely

### 1. Any registered user could become super admin (critical)

`api/middleware/auth.py` read the flag out of the JWT's `user_metadata` claim:

```python
user_meta = payload.get("user_metadata", {})
is_super_admin = user_meta.get("is_super_admin", False)
```

`006_multi_tenant.sql:23` provisioned it to match:

```sql
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"is_super_admin": true}'
```

`raw_user_meta_data` is surfaced as the `user_metadata` JWT claim, and it is
**the field Supabase lets a user write to their own row** — no service role
needed, the anon key in the browser is enough:

```js
await supabase.auth.updateUser({ data: { is_super_admin: true } })
```

On the next token refresh that user is a super admin. `require_super_admin()`
(`api/routers/households.py`) then admits them to `/admin/households`,
`/admin/invites` and `/admin/price-intelligence` — each of which runs a
service-role query with **no** `household_id` filter and returns every
household in the system. It also short-circuits the per-household admin check
in `households.py`, `savings.py` and `expenses.py`.

This is a one-line, self-service, full-tenancy read. It was the whole reason
this change exists.

### 2. `POST /setup/reset-qr` took no credential at all (high)

It was in `SKIP_AUTH_PATHS`, and the handler took no `Request` and checked
nothing — not even `X-Internal-Key`. Anyone on the internet could call it in a
loop and keep the shared WhatsApp bot permanently unpaired.

Worse in combination: `whatsapp_state` is a single module-global dict in
`api/routers/internal.py` serving *all* tenants, and `GET /setup/state` handed
its `qr` and its cross-tenant `groups` list to any authenticated user of any
household. Reset (unauthenticated) + read the QR (any member) = pair the shared
bot to your own WhatsApp account, disconnecting every other household.

### 3. `/webhook/whatsapp` accepted anonymous requests when unconfigured (high)

```python
instance_id = str(body.get("instanceData", {}).get("idInstance", ""))
if instance_id != os.getenv("GREEN_API_INSTANCE_ID", ""):
    return {"status": "ignored"}
```

With `GREEN_API_INSTANCE_ID` unset, a payload carrying no `instanceData` at all
evaluates `"" != ""` → `False` and **authenticates**. This route is in
`SKIP_AUTH_PATHS` and writes receipts against a `household_id` resolved from
the payload's own chat id.

### 4. The bot held a database-admin credential for three narrow operations (high)

`whatsapp/index.js` built a service-role Supabase client and used it for
exactly three things: one cross-household `settings` SELECT, one `reminders`
INSERT, and the Baileys session store in `db-auth-state.js`. Everything else it
does already went over `X-Internal-Key`.

So the process that parses untrusted input from the public internet, and whose
own filesystem holds WhatsApp session material, carried a never-expiring
every-table credential — to do one read and one write.

### 5. `INTERNAL_KEY` defaulted to a value published in this repository (medium)

`os.getenv("INTERNAL_KEY", "homly-internal")`, copy-pasted into six routers.
`backend/.env.example` claims the key is required and that internal endpoints
reject everything without it. The code did the opposite. With the variable
unset in production, `/internal/graph-invoke` — which accepts an arbitrary
`household_id` — was open to anyone who read this repo.

### 6. The service-role-key-as-bearer-token bypass (medium)

`api/middleware/auth.py` accepted the service role key as an `Authorization:
Bearer` value, granting `is_service_key` — every JWT-protected endpoint, with
`household_id` taken from the caller's own form/query params. Nothing sends it
any more (the bot's only such call is commented out at `index.js:403`).
Presenting a database-admin credential as an ordinary API token also puts it on
request paths where any proxy in front of the app may log it.

## What was done

| # | Fix |
|---|-----|
| 1 | Flag moves to `app_metadata` (service-role-write-only). Migration `037` copies existing super admins across and strips the flag from `raw_user_meta_data`. Frontend reads `app_metadata` too. |
| 2 | `/setup/reset-qr` leaves `SKIP_AUTH_PATHS` and requires household admin; `/setup/state` withholds `qr` and `groups` from non-admins and reports `can_manage`. |
| 3 | Webhook requires a *non-empty* expected instance id and a non-empty presented one, plus a constant-time internal-key compare. |
| 4 | New `GET /internal/settings`, `POST /internal/reminders`, and `/internal/wa-auth/*` (`api/routers/wa_auth.py`). `SUPABASE_KEY` and `SUPABASE_URL` are gone from the bot's environment and `@supabase/supabase-js` from its `package.json`. |
| 5 | One shared `services/internal_auth.py`. No default — an unset key returns 503 for every internal request. `hmac.compare_digest` instead of `!=`. The bot exits at startup without `INTERNAL_KEY`. |
| 6 | Branch deleted. |

## The approach that looked obvious and was wrong

**Adding a `user_metadata` fallback when moving the super-admin flag.** The
instinct during a metadata migration is to read the new location and fall back
to the old one so nobody loses access mid-deploy. Here that fallback *is* the
vulnerability — it re-opens the exact self-promotion path the change closes.
There is deliberately no fallback, and both old and new code fail *closed*
during the deploy gap: the worst case is a genuine super admin losing the admin
UI until their token refreshes. That is the correct trade. Don't "fix" it later
by adding the fallback back.

**Keeping the service-key bearer branch "just in case".** It is tempting to
leave it and only harden the comparison. But its whole purpose was to let the
bot authenticate, and the bot no longer uses it — leaving it means the app
still accepts its most dangerous credential on every public route.

## Deliberate narrowness

- **`GET /internal/settings` returns only `household_id`, `group_jid`,
  `group_name`.** That is what `groupMap` routes on. It looks under-built
  precisely because widening it hands the bot back the broad read access this
  change removed. Add a purpose-specific endpoint instead.
- **`/internal/reminders` resolves `household_id` from `group_jid` server-side**
  rather than accepting the bot's value. The bot's `groupMap` is refreshed on a
  five-minute timer; a stale entry would file a reminder against the wrong
  household. The server already owns the authoritative mapping.
- **`services/internal_auth.py` reads the env var per call, not at import.**
  Import-time capture would make the value untestable and would bake in
  whatever was set before `.env` loaded.

## What was NOT done

- **The QR is still cross-tenant.** `/setup/reset-qr` is now admin-gated rather
  than open, which closes the unauthenticated DoS, but a *single* bot process
  (`BOT_TENANT_ID`) serves every household, so an admin of household A can still
  pair the bot household B depends on. This is architectural, not a missing
  check: fixing it means one bot process per tenant, with `whatsapp_state` moved
  out of a module global and into per-tenant storage. `whatsapp_auth.tenant_id`
  is already keyed for exactly that. Left out deliberately — it is a
  product/infrastructure change, not a security patch.
- **The `is_service_key` blocks in eight routers were left in place.** With the
  middleware branch gone, `request.state.user` never carries that flag, so they
  are unreachable. Removing them touches household-resolution logic in
  `expenses.py`, `insurance.py`, `pantry.py`, `tasks.py`, `query.py` and
  `recipe.py` — business-logic churn that does not belong in a security change.
  They should be swept in a follow-up.
- **`tests/check_household_scoping.py` still reports 51 unreviewed queries.**
  Pre-existing; this change neither added to nor fixed that list — verified by
  running the guard against `origin/main` in a detached worktree and against
  this branch, and diffing the normalised finding sets: identical. Worth working
  through separately.
- **`ws` remains in the bot's `package.json`.** It was only there as the
  Supabase realtime transport and is now unused, but `node_modules` could not be
  installed in this environment to confirm Baileys pulls its own copy, so it was
  left rather than risk a runtime failure on an unverifiable assumption.

## Merged with `main`'s `services/db.py`

While this was in review, `main` landed `039-supabase-connection-retries`, which
introduced `services/db.py` and replaced ~40 per-module
`create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))` calls with
a single `get_supabase()`. Two consequences for this change:

- **`api/routers/wa_auth.py` uses `get_supabase()`**, not `create_client` —
  `main`'s rule is that `get_supabase()` is the only constructor in the backend.
- **It does not alter this audit's conclusions.** `get_supabase()` is still a
  *service-key* client: it bypasses RLS exactly as before, and household
  isolation is still enforced only by application-level `household_id` filters.
  Consolidating the client changes connection handling, not authority. The
  reason the WhatsApp bot must not hold that key is unchanged.

The two changes are complementary and merged without semantic conflict: `main`
also made `AuthMiddleware` return 503 when the household lookup *fails* (rather
than silently reading as "no household"), which sits directly above this
change's `app_metadata` read in the same function.

## Verification — what actually ran

Backend dependencies are not installed in the environment this was written in
and no package index was reachable (`pip install pytest` fails: "No matching
distribution found"). **The pytest suite was not run, and `tsc --noEmit` could
not resolve `react`/`next` because `frontend/node_modules` is absent.** What was
actually executed:

- `python3 -m compileall` over every touched Python file — clean.
- `node --check` on `whatsapp/index.js` and `whatsapp/db-auth-state.js` — clean.
- `tests/check_household_scoping.py` (pure stdlib, no deps) before and after the
  change — identical findings, only line-number shifts. No new unscoped query.
- `services/internal_auth.py`'s logic, executed against a stubbed `fastapi`
  module: unset key → 503, blank key → 503, correct key → pass, wrong key →
  403, missing header → 403, old `homly-internal` default → 403, env re-read per
  call. All pass.
- The webhook auth condition, old vs new, run as a standalone truth table. The
  old form accepts a fully anonymous request when `GREEN_API_INSTANCE_ID` is
  unset; the new one rejects it while both legitimate paths still pass.

`tests/test_internal_auth.py` was added and compiles, but **has not been
executed under pytest** — it needs to run in CI before this is trusted.
