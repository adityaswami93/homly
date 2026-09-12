# 040 — CI test pipeline: foundations

## Problem

The task was framed as "build testing that runs on every PR". **It already existed**, and
the most useful thing this document can record is that finding, because the obvious
approach — scaffold pytest, write some tests, add a workflow — would have duplicated or
overwritten a pipeline that is already better than what it would have replaced.

What was actually there before this change:

- `.github/workflows/ci.yml` running on every `pull_request`: a backend job (ruff,
  `compileall`, `pytest tests/`, plus an informational multi-tenancy scanner), a frontend
  job (eslint informational, `tsc --noEmit` and `next build` blocking), and a third job
  that upserts a sticky PR comment with per-step logs.
- 11 files in `backend/tests/` (~1,150 lines) with genuinely good conventions.

So the problem was not absence. It was five specific holes:

1. **You could not run locally what CI ran.** `pytest` and `ruff` were `pip install`ed ad
   hoc *inside the workflow file* and appeared in no requirements file. A contributor
   following `CLAUDE.md`'s own Local Development section ended up without a test runner.
2. **There was no pytest config at all** — no `pytest.ini`, no `pyproject.toml`. Imports
   worked only because CI happened to set `working-directory: backend` and a
   `sys.path.insert` in `conftest.py` propped it up.
3. **Every test that needed a database hand-rolled its own Supabase fake.**
   `test_reimbursement_totals.py` and `test_conversation_context.py` had grown two
   different ones supporting different subsets of the query builder — the exact drift
   `CLAUDE.md`'s "Backend stays DRY" rule warns about, one layer down.
4. **No lockfile anywhere.** `.gitignore` line 5 ignored `package-lock.json` *repo-wide*,
   which is why CI used `npm install` with caching disabled. Every run re-resolved the `^`
   ranges in `package.json`.
5. **Testing was invisible in `CLAUDE.md`** — the file the repo insists is the map for new
   agents. The word "test" appeared three times, none of them explaining how to run one.

## Solution

This is PR 1 of three; it deliberately contains **no new assertions about product
behaviour**, so it cannot fail for interesting reasons. Coverage and enforcement come next.

| Change | Why |
|---|---|
| `backend/requirements-dev.txt` | Declares the toolchain CI enforces. `-r requirements.txt` + pinned `ruff==0.15.8` and `pytest==9.0.2`. CI now installs from it. |
| `backend/pytest.ini` | `testpaths = tests`, `pythonpath = .`, `--strict-markers`. Makes `pytest` from `backend/` work without relying on cwd. |
| `backend/tests/fakes.py` | One `FakeSupabase`, replacing the per-file fakes. |
| `backend/tests/conftest.py` | `placeholder_env`, `fake_supabase`, `api_client` fixtures. |
| `backend/tests/test_fakes.py` | Tests for the fake itself — see below. |
| `.gitignore` | Dropped the `package-lock.json` line. |
| `CLAUDE.md` | New **Testing & CI** section; tree and Local Development updated. |

### Why the fake is tested

`assert_scoped_to()` is the runtime half of the multi-tenancy guard, and PR 2's router
tests will assert through it. A version that returned "no offenders" for every input would
make every one of those tests pass while checking nothing. So `test_fakes.py` asserts it
**fails** on a leak — including the case that matters most, which is not a missing filter
but a *wrong* one (`.eq("household_id", "hh-2")` when the request is for `hh-1`).

### Why `services.db._client` is the seeding hook

The codebase acquires the Supabase client two ways: ~12 modules do `supabase =
get_supabase()` at module scope (so it runs at *import*), and ~19 use a lazy `_db()`
accessor. Patching either pattern alone leaves the other live. Both funnel through
`get_supabase()`, which short-circuits on a populated `_client` — so seeding that one
global neutralises every call site at once. Modules already imported hold their own
reference and are re-pointed explicitly via `_MODULE_LEVEL_CLIENTS`.

### The approach that looked obvious and was wrong

**Testing routes by entering `TestClient(app)` as a context manager.** That is the
idiomatic FastAPI pattern and it is wrong here: entering the context runs `api/main.py`'s
`lifespan`, which starts APScheduler and calls `refresh_summaries()` against Supabase. A
route test would silently start background cron jobs. `api_client` constructs the client
*without* the `with` block, which skips lifespan entirely. This is signposted in both
`conftest.py` and `CLAUDE.md` because the correct code looks like the mistake.

### Deliberate narrowness

- **`FakeSupabase` is not a Postgres emulator.** No joins, no `or_`, single-column ordering
  only. When a test needs more than it offers, that is usually a signal the code under test
  wants a smaller pure function, not that the fake needs a query planner. Growing it into a
  database is how it stops being trustworthy.
- **`HOUSEHOLD_SCOPED_TABLES` is duplicated** between `fakes.py` and
  `check_household_scoping.py`. Deliberate: the scanner runs as a bare script with no
  pytest on the path, so it cannot import from a test module. Both files say so.
- **`conftest.py` keeps its `sys.path.insert`** even though `pytest.ini`'s `pythonpath = .`
  makes it redundant for a normal run. It is what lets a single module be run from a
  different cwd, and `api/main.py` / `api/routers/expenses.py` do their own
  `sys.path.append` regardless (which is why `ruff.toml` globally ignores `E402`).
  Untangling that is its own cleanup.

## What was left out

- **The frontend lockfile could not be generated.** This environment has no npm registry
  access (403 on `registry.npmjs.org`) and no PyPI access. Removing the `.gitignore` line
  was the half that could be done and is the half that was actually blocking; generating
  and committing `frontend/package-lock.json` needs someone with registry access, and the
  CI comment now says exactly that. **CI was deliberately left on `npm install`** —
  switching to `npm ci` without a lockfile present would turn the frontend job red
  immediately.
- **`test_conversation_context.py` still has its own local fake.** It could not be executed
  in this environment (it imports `agents.homly_graph`, which needs `langchain_core`), and
  migrating a passing test that cannot be run is not a trade worth making for a stylistic
  DRY win. It should move to `FakeSupabase` when someone can run the full suite; the rows
  need column-accurate seeding because the shared fake actually applies filters, where the
  local one returns its seed regardless.
- **Everything in PRs 2 and 3**: filling the coverage gaps (`chore_due_today`, `mcp_auth`,
  the auth middleware, an app-construction smoke test), making the scoping scanner
  blocking, the WhatsApp bot CI job, and frontend Vitest.

## Verification

Honest account, per `CLAUDE.md`:

**Ran, and passed, in this environment:**
- `pytest tests/test_fakes.py` — 13 passed.
- `pytest tests/test_receipts.py tests/test_reimbursement.py tests/test_reimbursement_totals.py tests/test_price_history.py` — 28 passed (27 before this change; the migration to
  `FakeSupabase` added one).
- `python tests/check_household_scoping.py` — runs, reports 51 findings (unchanged by this
  PR; triage is PR 2).
- `ruff check .` on the changed files.

**Could not be run here:** the six test modules that import `fastapi`, `supabase`, or
`langchain_core` — none of the backend runtime dependencies are installed and PyPI is
unreachable, so `pip install -r requirements-dev.txt` itself is unverified. Likewise
`npm run typecheck` and `npm run build`. **The first CI run on this PR is the verification
step for those**, including for `requirements-dev.txt` resolving at all.
