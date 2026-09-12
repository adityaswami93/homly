# 040 (part 2) — Coverage, a blocking tenancy guard, and CI for the bot

Part 1 (`implementation.md`) made the toolchain reproducible. This part makes the
pipeline actually catch things.

## Problem

Three gaps, in descending order of how badly they could bite:

1. **The multi-tenancy invariant had no working guard.** `CLAUDE.md` states plainly that
   RLS is disabled on every shared table and application code is the only thing stopping
   one household reading another's data. `tests/check_household_scoping.py` existed to
   guard that and was failing at it in two separate ways:
   - It reported **51 findings**, nearly all false positives, so nobody triaged them.
   - `__main__` never called `sys.exit`. **The CI step reported ✅ on every run** while
     printing 51 findings into its own collapsed log. It had been decorative since it
     was written.
   - Its `ALLOWED_UNSCOPED` was keyed by **line number**, so any edit above an exempted
     call silently moved the exemption onto a different query.
2. **Zero coverage on three things worth covering**: `chore_due_today()` (decides what
   every household is told each morning), `mcp_auth` (the bearer-token boundary for
   `/mcp/data/*`), and `bot_profile.should_engage()` (whether the bot speaks at all).
3. **`backend/whatsapp/` had no lint, no tests and no CI job** — the component that talks
   to households was the least covered thing in the repo.

## Solution

### The scoping scanner: 51 findings → 0, and now blocking

Rather than hand-marking 51 call sites — which is 51 opportunities to rubber-stamp a real
leak — the scanner learned the shapes this codebase actually uses. Four are now recognised:

| Pattern | Example |
|---|---|
| Filter in the statement | `.table("receipts").eq("household_id", hid)` |
| Chain built across statements | `q = db.table(...)` then `q = q.eq("household_id", hid)` |
| Write whose payload carries it | `row = {"household_id": hid, ...}` → `.insert(row)`; also list comprehensions and `rows.append(row)` accumulators |
| Key-filtered query in a function that already scoped | update-by-id after an ownership check; `items` by `receipt_id` from scoped `receipts` |

That takes 51 → 5. Each of the remaining five was read and marked with its reason:

- `admin.py` price intelligence — cross-household **by design**, `require_super_admin`.
- `reminders.py` ×2 — `/internal/reminders/due` serves every household the bot polls for,
  guarded by `X-Internal-Key`; there is no single household to scope to.
- `webhook.py` and `receipt_service.py` dedup — these must **not** be scoped.
  `whatsapp_message_id` is UNIQUE table-wide, so a household-scoped lookup would miss a
  duplicate and hit the constraint instead of deduping.

### Why a marker comment, not an allowlist

The old allowlist was keyed by line number. An allowlist that quietly stops allowlisting
what you meant is worse than no allowlist. A `# household-scope: ok — <reason>` marker
travels with the line it exempts, and the reason stays readable next to the code.

### The approach that looked obvious and was wrong

**Auto-allowing every update-by-id after an ownership check, by looking for `household_id`
anywhere in the enclosing function.** Almost every router function mentions `household_id`
somewhere, so that rule would have waved through a bare
`.table("receipts").select("*")` sitting in an otherwise-careful function. Pattern 4 is
therefore gated on the query being **narrowed by a key** (`id` or `*_id`). A query with no
key filter at all is still reported no matter what else the function does.

The residual risk is stated in the scanner's own docstring: a key that did not come from a
scoped query, in a function that scopes elsewhere, is accepted. That is why
`tests/fakes.py`'s `assert_scoped_to()` checks the same invariant at runtime — the two
guards fail in different ways on purpose.

### Deliberate narrowness

- `_appended_row_carries_it` resolves a `Name` **one level** to its dict binding, and
  cannot recurse. Deep dataflow is where a static check starts lying convincingly.
- The accumulator pattern requires **at least one** append and that **all** of them carry
  `household_id`. An empty accumulator proves nothing, and a half-migrated one — some
  branches scoped, some not — is exactly the bug worth catching, so it is reported.

### Coverage added

`test_chores.py` (10), `test_mcp_auth.py` (7), `test_bot_profile.py` (17),
`test_household_scoping_check.py` (20). `test_bot_profile.py` is promoted from
`scratch/test_bot_profile.py`, which ran the same checks as bare asserts outside pytest —
and therefore outside CI. **That file is deleted**, not left alongside; two copies drift.
The promoted version adds cases the scratch one lacked, notably that a regex
metacharacter in a user-set `bot_name` is escaped (`"c.a.t"` must not match `"cXaXt"`).

### WhatsApp bot

The five pure helpers in `index.js` — `stripLeadingMentions`, `ownPhone`,
`wasBotMentioned`, `isReplyToBot`, `parseRemindDuration` — moved to
`backend/whatsapp/lib/parsing.js` and are covered by 25 `node --test` cases. No new
dependency: node 20's test runner is built in, and the module imports nothing, so the job
needs no `npm install` and cannot break because of a transitive release.

`stripLeadingMentions` especially earns its tests: `CLAUDE.md` records that without it,
@-mentioning the bot broke *every* prefix-based match — custom commands, `/remind`, and
`classify_node`'s classification all check how the string starts.

**A bug found while building this job.** The first version of `npm run check` was
`find ... -exec node --check {} +`. It passed with a deliberately broken file in the tree,
because **`node --check` accepts only one file and silently ignores the rest**. It now
pipes through `xargs -n1`, and was verified to exit 123 with a broken file and 0 without.
This is the whole argument for testing a guard rather than assuming it: the useless
version looked completely correct.

## What was left out

- **The FastAPI route-level tests** — app-construction smoke test, auth-middleware
  coverage (`SKIP_AUTH_PATHS`, the service-key bypass, `X-Household-Id` honoured only for
  the caller's own memberships), and per-router tenancy tests through `assert_scoped_to`.
  The `api_client` fixture that makes them possible shipped in part 1, but none of them can
  be executed in this environment — `fastapi` and `supabase` are not installed and PyPI is
  unreachable. Writing a security test suite that has never once been run, and cannot be
  run before it is pushed, is not worth the false confidence; the auth middleware deserves
  tests that someone has watched fail. Next session with dependency access should add them.
- **Frontend Vitest and the helper extraction** — same reason, one step worse: adding
  Vitest means installing it, and npm is unreachable here.
- **ESLint changed-files ratchet** — deferred with the rest of the frontend work so it
  lands with the tests it belongs beside.

## Verification

**Ran here, passing:**
- `pytest` over the 8 dependency-free modules — **92 passed**.
- `python tests/check_household_scoping.py` — **exit 0**, no findings (was: 51 findings,
  exit 0).
- `ruff check .` — clean. `python -m compileall` — clean.
- `cd backend/whatsapp && npm test` — **25 passed**; `npm run check` — clean.
- **Both guards verified negatively**, which is the point: `test_household_scoping_check.py`
  asserts the scanner reports a bare select, a wrong-household filter, a half-scoped
  accumulator, and an unfiltered query in a function that scopes elsewhere; and
  `npm run check` was confirmed to exit non-zero with a broken file planted in the tree.

**Not runnable here:** the six test modules needing `fastapi`/`supabase`/`langchain_core`,
and anything npm. CI covers those on this PR.
