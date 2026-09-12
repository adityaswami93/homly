# 040 — CI test pipeline: foundations (release)

## What changed for the user

Nothing user-facing. No API change, no schema change, no change to how the bot behaves.
This is developer tooling: the checks that run on every PR are now reproducible and
runnable locally.

What changes for anyone working in this repo:

- `cd backend && pip install -r requirements-dev.txt && pytest` now works. Previously
  `pytest` was installed only inside the CI job and appeared in no requirements file.
- `cd frontend && npm run typecheck` now exists as a script rather than a bare
  `npx tsc --noEmit` buried in the workflow.
- There is one shared Supabase test double (`backend/tests/fakes.py`) instead of a
  hand-rolled fake per test file.
- `CLAUDE.md` has a **Testing & CI** section documenting what runs, what blocks, and the
  conventions that are load-bearing (notably: mock `services.llm_client` functions as
  module attributes, because call sites use function-local imports).

- The multi-tenancy scan is now **blocking** and reports **0 findings** (was 51, and was
  reporting ✅ regardless because it never called `sys.exit`).
- `backend/whatsapp/` has a CI job for the first time: `npm run check` (syntax) and
  `npm test` (25 cases over the pure parsing helpers, no dependencies).

## Files touched

**New**
- `backend/requirements-dev.txt`
- `backend/pytest.ini`
- `backend/tests/fakes.py`
- `backend/tests/test_fakes.py`
- `backend/tests/test_chores.py`, `test_mcp_auth.py`, `test_bot_profile.py`,
  `test_household_scoping_check.py`
- `backend/whatsapp/lib/parsing.js`, `backend/whatsapp/lib/parsing.test.js`
- `frontend/vitest.config.ts`
- `frontend/lib/dates.ts`, `frontend/lib/insurance.ts` (+ their `.test.ts`)
- `frontend/lib/apiUrl.test.ts`, `frontend/config/apps.test.ts`
- `documents/040-ci-test-pipeline/{implementation,implementation-part2,implementation-part3,release}.md`

**Deleted**
- `backend/scratch/test_bot_profile.py` — promoted into `backend/tests/test_bot_profile.py`
  as real pytest; keeping both would let them drift.
- `frontend/lib/weekUtils.ts` — exported `isoWeek`/`isoWeekYear`, imported nowhere, while
  two pages hand-rolled their own ISO-week maths.

**Modified**
- `backend/tests/conftest.py` — added `placeholder_env`, `fake_supabase`, `api_client`
- `backend/tests/check_household_scoping.py` — four recognised safe patterns, marker-comment
  exemptions replacing the line-number allowlist, `analyse_source()` split out so the rules
  are testable, and a real non-zero exit
- `backend/tests/test_reimbursement_totals.py` — migrated to the shared fake; two new assertions
- `backend/api/routers/{admin,reminders,webhook}.py`, `backend/services/receipt_service.py` —
  `# household-scope: ok` markers with reasons. **Comments only; no logic changed.**
- `backend/whatsapp/index.js` — imports the five helpers from `lib/parsing.js` instead of
  defining them (pure move, no behaviour change)
- `backend/whatsapp/package.json` — added `test` and `check` scripts
- `.github/workflows/ci.yml` — installs `requirements-dev.txt`; `pytest -v`; `npm run typecheck`;
  pip cache key follows both requirements files; scoping scan made blocking; new `whatsapp` job
  wired into the sticky PR comment; updated the lockfile TODO
- `.gitignore` — removed the repo-wide `package-lock.json` ignore
- `frontend/package.json` — added `typecheck` and `test` scripts, and `vitest` as a devDependency
- `frontend/app/(shell)/expenses/{page,history/page,reimburse/page}.tsx`,
  `frontend/app/(shell)/insurance/{page,renewals/page}.tsx` — import the shared helpers
  instead of each defining their own copy. **No behaviour change**; the differing
  date-formatting wrappers were deliberately left in place.
- `CLAUDE.md` — new Testing & CI section; Project Structure tree; Local Development;
  WhatsApp Bot key patterns

## Migrations to run

**None.** No schema change.

## Environment variables

**None added.** Tests set their own placeholders via the `placeholder_env` fixture; no CI
secrets are required. The frontend build already used placeholder `NEXT_PUBLIC_*` values
and still does.

## Deploy order

No deploy required — nothing here ships to Railway or Vercel. `requirements-dev.txt` is
deliberately separate from `requirements.txt` so the production image does not grow a test
runner.

## How to verify it worked

1. **CI is green on this PR**, with the backend job's "Install dependencies" step now
   showing a single `pip install -r requirements-dev.txt`.
2. The sticky PR comment still renders all six sections (ruff, compile, pytest, scoping,
   eslint, typecheck, build).
3. The pytest step reports **more** tests than before, not fewer — `test_fakes.py` adds 13.
4. Locally: `cd backend && pip install -r requirements-dev.txt && pytest` passes with no
   arguments, from the `backend/` directory.

## Known issues / what's deliberately not done here

- **`frontend/package-lock.json` still does not exist**, so CI still runs `npm install`,
  not `npm ci`, and npm caching stays off. The `.gitignore` line that made committing a
  lockfile impossible is gone — that was the actual blocker — but generating one needs npm
  registry access, which the environment this was authored in did not have (403 on
  `registry.npmjs.org`). **Next step for someone with registry access:**
  `cd frontend && npm install && git add -f package-lock.json`, then in `ci.yml` switch to
  `npm ci` and restore `cache: npm` with
  `cache-dependency-path: frontend/package-lock.json`. Until then, a transitive release can
  turn the frontend job red with no commit to this repo.
- **A red check still does not block a merge.** The workflow's `exit 1` marks the run
  failed; preventing a merge requires a branch protection rule or ruleset on `main` that
  requires these checks by name (Settings → Rules). Worth adding
  `Backend (lint + test + import check)` and `Frontend (lint + typecheck + build)` now.
- **The eslint changed-files ratchet ships but is not blocking yet.** It reports into the
  PR comment; flipping it is one line, documented on the step. It was left off because this
  same change edits five existing page components that may carry pre-existing findings, and
  eslint could not be run here to check — see `implementation-part3.md`.
- **No FastAPI route-level tests yet** — the app smoke test, auth-middleware coverage, and
  per-router tenancy tests. The `api_client` fixture for them exists; the tests do not,
  because they cannot be run in the environment this was authored in and a security test
  suite nobody has watched fail is not worth the confidence it implies. See
  `implementation-part2.md`.
- **Receipt re-aggregation in `expenses/page.tsx` is still client-side and still drifted**
  between its two copies. It is now flagged as the top remaining offender in `CLAUDE.md`;
  the fix is a backend field, not a frontend test.
- `backend/tests/test_conversation_context.py` still carries its own local Supabase fake —
  see `implementation.md` for why it was not migrated.
- `backend/whatsapp/` has no linter (only syntax checking). ESLint there would be a
  separate change with its own dependency and config.

## Verification honesty note

Per `CLAUDE.md`: the environment this was authored in had **no PyPI and no npm access**,
and none of the backend runtime dependencies installed.

**Ran and passed here:** `pytest` over the 8 dependency-free modules (92 passed),
`ruff check .` (clean), `python -m compileall` (clean),
`python tests/check_household_scoping.py` (exit 0, no findings), and in
`backend/whatsapp`, `npm test` (25 passed) and `npm run check` (clean).

**Both new guards were also verified negatively**, which is the part that matters:
`test_household_scoping_check.py` asserts the scanner still reports a bare select, a
wrong-household filter, a half-scoped accumulator and an unfiltered query; and
`npm run check` was confirmed to exit non-zero with a deliberately broken file in the tree
(its first implementation did not — see `implementation-part2.md`).

**The frontend helpers were verified without Vitest**, by compiling them with the system
`tsc --strict` and running the same cases under `node --test` against the compiled output —
13 cases, all passing, including that `getWeekRange(2026, 1)` starts on 2025-12-29 and that
`config/apps.test.ts`'s filesystem check rejects a bogus route as well as accepting the real
ones. The assertions are verified; only the Vitest harness wiring is not.

**Did not run here:** `pip install -r requirements-dev.txt` itself, the six test modules
requiring `fastapi` / `supabase` / `langchain_core`, and anything npm — Vitest,
`npm run typecheck` over the whole app, `next build`, eslint. The first CI run on this PR is
the real verification for those, and the frontend page edits (delete a local function, add
an import) have been grep-checked but not typechecked in situ.
