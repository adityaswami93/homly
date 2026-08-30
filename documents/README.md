# Homly Development Documents

Each feature is documented in its own folder under `documents/`.

## Folder naming convention
documents/{issue_number}-{short_name}/
├── implementation.md   # Claude Code prompt + technical details
└── release.md          # What was built, how to deploy, what changed

## Example
documents/001-receipt-ocr/
documents/002-soft-delete/
documents/003-settings/
documents/004-sender/
documents/005-messages/

## Issue index

| # | Name | Description | Status |
|---|------|-------------|--------|
| 001 | receipt-ocr | Core OCR pipeline, WhatsApp bot, FastAPI backend, Next.js dashboard | ✅ Released |
| 002 | soft-delete | Soft delete receipts from dashboard | ✅ Released |
| 003 | settings | Configurable summary schedule, cutoff mode, group name | ✅ Released |
| 004 | sender | Capture who posted each receipt | ✅ Released |
| 005 | messages | Send messages to WhatsApp group from dashboard | ✅ Released |
| 006 | multi-tenant | Households, household_members, household_id filtering, invite flow | ✅ Released |
| 007 | auth-pages | Password reset + magic link login flows, Supabase callback pages | ✅ Released |
| 008 | toast | Toast notification system across all interactive pages | ✅ Released |
| 009 | qr-reset | QR code regeneration from setup page + bot auth refactor (service key) | ✅ Released |
| 010 | setup-group-ux | Saved group display, change group flow, group search on setup page | ✅ Released |
| 011 | mobile-responsive | Mobile bottom nav, bottom-sheet drawer, responsive grids and forms | ✅ Released |
| 012 | edit-receipt-date | Admin/super-admin can edit receipt date from drawer; auto-recalculates week | ✅ Released |
| 017 | insurance-document-analysis | Upload policy documents → AI extraction, auto-fill, coverage summary, Coverage Checker page | 🔄 In Review |
| 023 | reimbursement-calc-fix | Fix "to reimburse" total (custom-week vs ISO-week mismatch), move calc to backend, dedupe get_reimbursable() | ✅ Released |
| 024 | agentic-supervisor | LangGraph ReAct supervisor replacing the single-shot query router; pluggable LLM adapter/factory | 🔄 In Review |
| 025–036 | *(not documented)* | Shipped before documentation became a required part of every PR — see the note below | ⚠️ Undocumented |
| 037 | conversation-memory | Rolling per-group chat transcript giving the WhatsApp assistant short-term memory (follow-ups, replies to itself) | 🔄 In Review |

> **The 025–036 gap is a warning, not a precedent.** Roughly a dozen features —
> the pantry confirmation flow, household chores, MCP data queries, the Alembic
> migration runner, bot personality/engagement modes, the proactive monitor — shipped
> with no entry here. Their design decisions now live only in commit messages and in
> whatever made it into `CLAUDE.md`. That is exactly the cost this folder exists to
> avoid, and it is why documentation is now **required in the same PR as the code**
> rather than promised as a follow-up. See "Every PR ships its documentation" in
> `CLAUDE.md`.

---

## How to use

### Starting a new feature

1. Create a new folder: `documents/{next_issue_number}-{short_name}/`
2. Create `implementation.md` with the Claude Code prompt and technical plan
3. Paste the prompt into Claude Code IDE
4. After release, fill in `release.md`

### Document templates

See below for templates.

---

## Implementation template

`implementation.md` should contain:
```markdown
# {Issue number} — {Feature name}

## Problem
What pain point does this solve?

## Solution
High level approach.

## Claude Code prompt
(paste the full prompt here after creating it)

## Technical notes
Any decisions, tradeoffs, or context worth remembering.
```

## Release template

`release.md` should contain:
```markdown
# {Issue number} — {Feature name} — Release

## What was built
Summary of changes.

## Files changed
- `path/to/file.py` — what changed
- `path/to/file.tsx` — what changed

## Database migrations
List any SQL files that need to be run in Supabase.

## Environment variables
Any new env vars added.

## Deployment steps
Any manual steps required beyond pushing to GitHub.

## Known issues
Anything not working or left for later.
```
