# 040 — Service role key audit · Release notes

**Type:** security fix (one critical, three high, two medium)
**Depends on:** 039 (`services/db.py`) — merged, no action needed
**Breaking:** yes — see *Deploy order* and *Breaking changes* below. Read both before deploying.

---

## What changed for the user

Almost nothing visible, by design:

- **Household members who are not admins** no longer see the WhatsApp pairing QR
  or the group picker on `/setup`. They see *"WhatsApp isn't connected yet. Ask a
  household admin to set it up."* Admins are unaffected.
- **Super admins** lose the admin UI until their JWT refreshes after deploy (sign
  out and back in to force it).
- Everything else — receipts, chores, the bot, summaries — behaves identically.

What changed underneath is who can reach other households' data, and which
processes hold a credential that can read all of it.

---

## Deploy order

This one matters. Out of order, super admins lose access temporarily; there is
no window where anything is *more* exposed.

1. **Run the migration** — `cd backend && alembic upgrade head` (revision
   `037_super_admin_app_metadata`).
   **Before running it**, inspect who is about to be promoted:
   ```sql
   SELECT email, raw_user_meta_data->>'is_super_admin'
   FROM auth.users
   WHERE raw_user_meta_data->>'is_super_admin' = 'true';
   ```
   The migration cannot tell an operator-granted flag from one a user set on
   themselves — that ambiguity *is* the vulnerability being fixed. If anyone
   unexpected appears, edit the migration's first `UPDATE` to an explicit email
   list before applying it.
2. **Set `INTERNAL_KEY`** in the backend environment **and** in the WhatsApp bot
   environment, to the same value, if it isn't already set explicitly. It no
   longer has a default. If it is currently unset, pick a random secret now —
   internal endpoints return 503 without it and the bot refuses to start.
3. **Deploy the backend** (Railway).
4. **Deploy the bot** (Railway) — it calls endpoints added in step 3, so it must
   come after.
5. **Deploy the frontend** (Vercel).
6. **Remove `SUPABASE_KEY` and `SUPABASE_URL` from the bot service's
   environment.** They are no longer read. Leaving them is not fatal but keeps a
   database-admin credential in a process that no longer needs one.
7. **Rotate the Supabase service role key** if you want the full benefit — it has
   been present in the bot process and in its deploy logs historically. Update
   `SUPABASE_KEY` on the **backend** service only.

---

## Breaking changes

- **Anything authenticating to this API with the Supabase service role key as a
  `Bearer` token will now get 401.** No in-repo caller does this (the bot's only
  such call has been commented out since the LangGraph migration). If you have an
  undocumented external integration doing it — a script, a mobile build, a
  Zapier job — it must move to an MCP key (`POST /mcp/keys`) or, for
  server-to-server use, `X-Internal-Key`. Check backend access logs for
  `Authorization: Bearer <service key>` before deploying if you're unsure.
- **`INTERNAL_KEY` has no default.** Unset ⇒ every `/internal/*` endpoint
  returns 503 and the bot exits at startup. `homly-internal` is no longer
  accepted as a fallback anywhere.
- **`GREEN_API_INSTANCE_ID` must be set** if you rely on the Green API path into
  `/webhook/whatsapp`. Unset now rejects that path (it previously accepted
  anonymous requests).
- **`POST /setup/reset-qr` requires a JWT and household admin.** Any script
  calling it unauthenticated will get 401.

---

## Migrations to run

| Revision | File | What it does |
|----------|------|--------------|
| `037_super_admin_app_metadata` | `backend/migrations/037_super_admin_app_metadata.sql` | Copies `is_super_admin` from `auth.users.raw_user_meta_data` into `raw_app_meta_data`, then strips it from `raw_user_meta_data` for everyone |

`alembic upgrade head`. Roll-forward only, as with every migration here.

**Granting super admin from now on:**
```sql
UPDATE auth.users
SET raw_app_meta_data =
      COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"is_super_admin": true}'::jsonb
WHERE email = 'your@email.com';
```
Takes effect on that user's next token refresh. The old
`raw_user_meta_data` command from `006_multi_tenant.sql` no longer grants
anything — that is the point.

---

## Environment variables

| Variable | Service | Change |
|----------|---------|--------|
| `INTERNAL_KEY` | backend + bot | **Now genuinely required.** No default. Must match between the two. |
| `GREEN_API_INSTANCE_ID` | backend | Must be non-empty to enable the Green API webhook path |
| `SUPABASE_KEY` | **bot** | **Remove.** No longer read. |
| `SUPABASE_URL` | **bot** | **Remove.** No longer read. |
| `SUPABASE_KEY` / `SUPABASE_URL` | backend | Unchanged — still required |
| `BOT_TENANT_ID` | bot | Unchanged (defaults to `default`) |

---

## Files touched

**Backend**
- `api/middleware/auth.py` — `is_super_admin` from `app_metadata`; service-key bearer branch removed; `/setup/reset-qr` out of `SKIP_AUTH_PATHS`; new internal paths added
- `services/internal_auth.py` — **new.** `require_internal_key()` / `has_internal_key()`; no default, constant-time compare
- `api/routers/wa_auth.py` — **new.** `/internal/wa-auth`, `/upsert`, `/delete`, `/clear` (uses `services/db.get_supabase()`, per 039)
- `api/routers/setup.py` — admin-gated reset and QR/group visibility; `can_manage` in the response
- `api/routers/settings.py` — new `GET /internal/settings`
- `api/routers/reminders.py` — new `POST /internal/reminders`
- `api/routers/webhook.py` — anonymous-acceptance bug fixed
- `api/routers/{internal,messages,commands,pantry}.py` — use the shared gate
- `api/main.py` — registers `wa_auth`
- `migrations/037_super_admin_app_metadata.sql` + `alembic/versions/202609120900_037_…py` — **new**
- `tests/test_internal_auth.py` — **new**

**WhatsApp bot**
- `whatsapp/index.js` — Supabase client removed; `groupMap` and `/remind` go through the backend; fails fast without `INTERNAL_KEY`; dead service-key snippet deleted
- `whatsapp/db-auth-state.js` — session store now goes through `/internal/wa-auth/*`
- `whatsapp/package.json` — `@supabase/supabase-js` dropped
- `whatsapp/.env.example` — `SUPABASE_*` removed

**Frontend**
- Seven pages + `Navbar.tsx` read `app_metadata` instead of `user_metadata`
- `app/(shell)/setup/page.tsx` — handles the non-admin case

---

## How to verify it worked

1. **Privilege escalation is closed.** As a non-super-admin, in the browser
   console on the dashboard:
   ```js
   await supabase.auth.updateUser({ data: { is_super_admin: true } })
   await supabase.auth.refreshSession()
   ```
   then call `GET /admin/households`. Expect **403**. Before this change it
   returned every household.
2. **Real super admins still work.** Sign out, sign back in (to refresh the JWT),
   load `/admin`. Expect the households list.
3. **QR reset needs auth.** `curl -X POST $API/setup/reset-qr` with no header →
   **401**. With a non-admin member's JWT → **403**. With an admin's JWT → `{"status":"ok"}`.
4. **Non-admins can't see the QR.** As a member, `GET /setup/state` → `qr: null`,
   `groups: []`, `can_manage: false`.
5. **Internal endpoints are gated.** `curl $API/internal/settings` with no header
   → 403; with `X-Internal-Key: homly-internal` → 403; with the real key → the
   group list.
6. **Webhook rejects anonymous posts.**
   `curl -X POST $API/webhook/whatsapp -H 'content-type: application/json' -d '{"typeWebhook":"incomingMessageReceived"}'`
   → `{"status":"ignored"}`.
7. **The bot still works without the service key.** After step 6 of the deploy
   order, restart it and confirm in the logs: `groupMap refreshed — N household(s)`
   (proves `/internal/settings`), no re-pairing prompt (proves `/internal/wa-auth`
   loaded the session), then send `/remind 30m test` in a household group and
   confirm the confirmation message (proves `/internal/reminders`).

---

## Known issues / residual risk

- **The pairing QR is still cross-tenant.** One bot process serves every
  household, so a household *admin* can still pair the shared bot and disconnect
  everyone else. Now requires an authenticated admin rather than being open to
  the internet, but the isolation gap is real. The fix is per-tenant bot
  processes — see `implementation.md`, *What was NOT done*.
- **Existing JWTs stay valid until they expire.** A user who had already granted
  themselves `user_metadata.is_super_admin` keeps it in their current token —
  but the backend no longer reads that claim, so it grants nothing from the
  moment the backend deploys.
- **Eight routers still contain unreachable `is_service_key` blocks.** Dead
  after this change; scheduled for a follow-up sweep.
- **`tests/check_household_scoping.py` still reports 51 unreviewed queries**,
  unchanged by this work (verified by diffing the guard's findings against
  `origin/main`).

---

## Verification honesty

**The pytest suite was not run and the frontend was not typechecked.** Backend
dependencies are not installed in the authoring environment and no package index
was reachable; `frontend/node_modules` is absent. What *was* run: `compileall`
on all touched Python, `node --check` on both bot files, the household-scoping
guard before and after (identical findings), the `internal_auth` logic against a
stubbed `fastapi` (all assertions pass), and an old-vs-new truth table for the
webhook condition. `tests/test_internal_auth.py` compiles but **has not executed
under pytest** — run CI before trusting this.
