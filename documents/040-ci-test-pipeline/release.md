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

## Files touched

**New**
- `backend/requirements-dev.txt`
- `backend/pytest.ini`
- `backend/tests/fakes.py`
- `backend/tests/test_fakes.py`
- `documents/040-ci-test-pipeline/{implementation,release}.md`

**Modified**
- `backend/tests/conftest.py` — added `placeholder_env`, `fake_supabase`, `api_client`
- `backend/tests/test_reimbursement_totals.py` — migrated to the shared fake; two new assertions
- `.github/workflows/ci.yml` — installs `requirements-dev.txt`; `pytest -v`; `npm run typecheck`; pip cache key follows the dev requirements; updated the lockfile TODO
- `.gitignore` — removed the repo-wide `package-lock.json` ignore
- `frontend/package.json` — added the `typecheck` script
- `CLAUDE.md` — new Testing & CI section; Project Structure tree; Local Development

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
- **eslint and the multi-tenancy scanner remain informational.** eslint has ~104
  pre-existing findings; the scanner reports 51 findings that are mostly false positives of
  two safe patterns. Both are addressed in the follow-up PRs, not here.
- `backend/tests/test_conversation_context.py` still carries its own local Supabase fake —
  see `implementation.md` for why it was not migrated.
- `backend/whatsapp/` still has no lint, no tests, and no CI job.

## Verification honesty note

Per `CLAUDE.md`: the environment this was authored in had **no PyPI and no npm access**,
and none of the backend runtime dependencies installed. What actually ran and passed here:
`pytest` over the five dependency-free modules (41 passed), `ruff check .` (clean),
`python -m compileall`, and `tests/check_household_scoping.py`. What did **not** run here:
`pip install -r requirements-dev.txt` itself, the six test modules requiring `fastapi` /
`supabase` / `langchain_core`, and anything npm. The first CI run on this PR is the real
verification for those.
