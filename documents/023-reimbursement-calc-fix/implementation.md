# 023 — Reimbursement Total Calculation Fix

## Problem
The "to reimburse" total on the Expenses Overview page could show a wrong amount. The frontend netted an "already paid" figure against the gross reimbursable total using an ISO week/year *approximated* from the household's custom summary week (`settings.summary_day`), instead of the true ISO week each receipt is actually stored under. When the custom week didn't align with the Monday–Sunday ISO grid, this could pull in a payment recorded for a different week, understating what was actually still owed.

Reported via a screenshot: two receipts (SGD 16.65 + 46.30 = SGD 62.95, both correctly flagged `reimbursable`) were displaying "SGD 35.82 to reimburse" instead of 62.95.

## Solution
- Moved ISO-week grouping and "amount already paid" computation out of the frontend and into the backend.
- `GET /receipts/daterange` now returns `already_paid` and `outstanding_reimbursable_total`, computed server-side by grouping the range's reimbursable receipts by their real stored `week_number`/`year` and summing paid amounts per real week.
- Added `POST /receipts/daterange/mark-paid`, which re-reads receipts fresh for the given date range and settles every real ISO week represented, in one call.
- `expenses/page.tsx` now just reads `already_paid` / `outstanding_reimbursable_total` from the API response and calls the new mark-paid endpoint — no client-side week math left.
- Extracted the duplicated `get_reimbursable()` eligibility rule (copy-pasted in `api/routers/expenses.py` and `api/routers/webhook.py`, and reached into via a layering-breaking lazy import from `services/receipt_service.py`) into `backend/services/reimbursement.py`, imported by all three call sites.
- Added five conventions to `CLAUDE.md`: "Keep This File in Sync", "Frontend stays thin — business logic lives in the backend", "Backend stays DRY", "Multi-tenancy: every query must filter by household_id", and "check migration numbers before creating one".

## Claude Code prompts
The prompts that drove this change, in order:
1. *(receipt screenshot attached)* "total reimburse amount is incorrect. 39.01 should not be included but other 2 should be"
2. "why is the logic in frontend? fronted should be simple and show values from backend."
3. "now scan the codenase to see complicated fronted code that should be in backend. add the rule of keeping fronted simple and straightforward to claude md file. update the rule as fit for coding agent"
4. "any other rules we should add to claude md file?"
5. "fix the get_reimbursable issue"
6. "check copilot comments"

## Technical notes
- Root cause required first confirming (via Q&A) which receipts were actually flagged `reimbursable` correctly, then tracing `loadDateRange`/`handleMarkPaid` in `expenses/page.tsx` to find the frontend was deriving a synthetic ISO week from the custom week's start date — a Sunday/Thursday-pivot edge case in the ISO-week algorithm can put a custom week's first day in a different real ISO week than most of that week's receipts.
- The first fix pass corrected *which* week to query but kept the computation client-side. The user flagged that as an architecture violation before "frontend stays thin" existed as a written rule, so a second pass moved the computation server-side entirely and the rule was documented afterward.
- A follow-up codebase audit (via a subagent) found ~10 other places with similar client-side business logic (`expenses/reimburse/page.tsx`, `insurance/page.tsx`, `savings/page.tsx`, `budgets/page.tsx`, etc.) — logged in CLAUDE.md as known offenders to clean up opportunistically, not fixed in this PR.
- GitHub Copilot's automated PR review caught that the new "Keep This File in Sync" rule itself hard-coded exact file counts (28 migrations / 21 routers) that were already stale at PR time (26 / 20) — fixed by pointing at `ls` instead of a fixed number.
- No automated test suite exists in this repo. Verification was via `tsc --noEmit`, a Python `ast.parse` syntax check, and installing backend deps into a venv to actually import all touched modules and boot the FastAPI app (92 routes) — catching any circular-import regression from the `get_reimbursable` extraction before it could ship.
