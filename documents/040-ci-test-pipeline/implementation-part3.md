# 040 (part 3) — Frontend: dedupe the maths, then test it

## Problem

The frontend had no test runner at all, and the logic worth testing was **unexported and
inline inside page components**, so it could not be imported even if one existed:

| Logic | Where | Duplicated? |
|---|---|---|
| `getCustomWeekStart` / `getCustomWeekEnd` / `toDateStr` | `expenses/page.tsx` | no |
| `getWeekRange` | `expenses/history/page.tsx`, `expenses/reimburse/page.tsx` | **byte-identical ×2** |
| `daysUntil` | `insurance/page.tsx`, `insurance/renewals/page.tsx` | **byte-identical ×2** |
| `monthlyPremium` | `insurance/page.tsx` | no |

`getCustomWeekStart` is the one with history: CLAUDE.md records that a custom-week vs
ISO-week mismatch here caused a **real reimbursement-total bug**. Its first line converts
between the backend's `0=Mon..6=Sun` and JavaScript's `0=Sun..6=Sat` — an off-by-one that
is invisible on a Monday and wrong for the rest of the week.

`lib/weekUtils.ts` also existed, exporting `isoWeek`/`isoWeekYear`, **imported nowhere**,
while two pages hand-rolled their own ISO-week maths a few directories away.

## Solution

Extract to `lib/dates.ts` and `lib/insurance.ts`, delete the duplicate copies, add Vitest,
test them. Delete `lib/weekUtils.ts`.

The formatting wrappers stayed in their components on purpose. `fmtDateRange` (history)
puts the year on the end date and `formatWeekRange` (reimburse) does not — collapsing
those would be a behaviour change dressed as a refactor. Only `getWeekRange`, which is
genuinely identical, moved.

`daysUntil` gained an injectable `now` parameter. It read `new Date()` internally, which
made it untestable without fake timers and meant a list of policies could in principle
render against two different "todays".

### This is explicitly not a blessing

CLAUDE.md's "Frontend stays thin" rule says this maths belongs in the backend, and it names
this exact code. `lib/dates.ts` is a **staging post**: somewhere the duplicates could be
collapsed into one tested implementation so that moving each function server-side is
verifiable rather than a leap. That is written at the top of the module, in the CLAUDE.md
section, and here — because in six months a tested helper looks like a settled decision.

### How this was verified without npm

The environment had no npm registry access, so Vitest could not be installed or run. Rather
than ship assertions nobody has ever executed, the extracted modules were compiled with the
system `tsc` (`--strict`) and exercised under `node --test` against the **compiled output**,
using the same cases the Vitest suite contains. That verifies the part that can be wrong in
an interesting way — the expected values — and leaves only the harness wiring unproven.

Facts that check confirmed rather than assumed:
- `getWeekRange(2026, 1).start` is **2025-12-29** — ISO week 1 of 2026 starts in the
  previous calendar year, because 4 January 2026 is a Sunday.
- `getWeekRange` yields Monday→Sunday for all of weeks 1–52.
- `getCustomWeekStart` returns a 7-day window containing the date for all 49
  (summaryDay × weekday) combinations, and does not mutate its argument.
- `config/apps.test.ts`'s `routeExists` — a real bit of logic that walks `app/` allowing for
  route groups like `(shell)` — resolves every current nav href **and** correctly rejects
  `/nope` and `/expenses/does-not-exist`. A filesystem check that returns true for
  everything would have passed silently.

## The ESLint ratchet: added, deliberately not blocking yet

The plan was to block on lint for files a PR touches, letting the ~104 pre-existing findings
burn down separately. The step is there and reports into the PR comment — but it is **not**
in the blocking condition, and that is a considered retreat rather than an oversight.

This same change edits five existing page components. Those files may carry pre-existing
findings of their own, and eslint could not be run here to find out. Making the gate
blocking in the change that introduces it risked red-flagging its own PR for reasons
unrelated to the work. The step's output on the first run is exactly the evidence needed:
if it reports clean on a normal PR, flipping it is one line (`steps.eslint_changed.outcome`
added to the frontend job's fail condition). That is written on the step.

## What was left out

- **Receipt re-aggregation** in `expenses/page.tsx:handleDelete`/`handleToggleReimbursable`.
  It lives inside `useState` updater closures and captures `totalPaid`, so extraction is a
  real refactor — and the two copies have **already drifted**
  (`round(Math.max(0, x - totalPaid))` vs `Math.max(0, round(x - totalPaid))`). The right
  fix is not to test it in place but to have the backend return the recomputed week; it is
  now called out as the top remaining offender in CLAUDE.md rather than left in a list of
  four equals.
- **Component tests.** `vitest.config.ts` uses `environment: "node"` and there is no
  `jsdom` or `@testing-library/react` dependency, so nothing pays jsdom's startup cost for
  tests that do not need it. Add both with the first component test.
- **`lib/axios.ts` and `lib/toast.ts`.** Both are testable but need `lib/supabase` and
  `window.location` mocked, or `renderHook` — more harness than value while the harness
  itself is unverified.

## Verification

**Ran and passed here:** `tsc --ignoreConfig --strict` over `lib/dates.ts`,
`lib/insurance.ts` and `config/apps.ts`; 13 `node --test` cases against the compiled output,
covering every assertion the Vitest suites make about those helpers; and the `routeExists`
check against the real `app/` tree, in both the positive and negative direction.

**Not runnable here:** Vitest itself, `npm run typecheck` over the whole app (needs
`node_modules`), `next build`, and eslint. The page-component edits are mechanical — delete
a local function, add an import — and were checked by grep for leftover definitions and
correct import placement, but they have not been typechecked in situ. **The first CI run is
the verification for all of that**, and if the Vitest harness needs a correction, that is
where it will show.
