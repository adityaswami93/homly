# Homly

## Project Overview

Homly is a household expense tracker powered by WhatsApp. Household members photograph receipts in a shared WhatsApp group; the bot OCR-analyses them, stores structured data, and delivers weekly expense summaries back to the group. A web dashboard lets admins manage settings, view expenses by week, and connect the WhatsApp bot.

The platform is **multi-tenant**: one backend and one WhatsApp bot instance serve multiple households simultaneously, each isolated by `household_id`.

---

## Keep This File in Sync

This file is the primary map new coding agents use to orient in the repo — an out-of-date entry is worse than no entry, because it's trusted by default. **When your change adds a new backend router, a new migration, or a new frontend app/page, update the matching section of this file (Project Structure, API Endpoints, Database Schema, Migrations, Apps Config) in the same change**, not as a follow-up.

This has already drifted once: `backend/api/routers/` has noticeably more router files than are mentioned in Project Structure/API Endpoints, and `backend/migrations/` has noticeably more files than are listed under Migrations. Don't treat updating this file as optional polish — a missing endpoint or table here means the next agent (or human) makes decisions on incomplete information. Run `ls backend/api/routers` / `ls backend/migrations` if you need the current exact counts; don't hard-code them here, since they'll just drift again.

---

## Every PR Ships Its Documentation

**Every PR adds or updates a `documents/<task-ID>-<short-name>/` folder, in the same
change as the code.** Not a follow-up, not "if the change is big enough", not a promise
in the PR description. A PR that changes behaviour and ships no document is incomplete
in the same way a PR that changes behaviour and ships no code is.

Two files, both required, templates in `documents/README.md`:

| File | Answers | Written for |
|------|---------|-------------|
| `implementation.md` | What was broken, why *this* approach, what was rejected and why, what's deliberately narrow, what was left out | The next agent who has to change this code and needs the reasoning, not the diff |
| `release.md` | What changed for the user, files touched, **migrations to run**, env vars, deploy order, how to verify it worked, known issues | Whoever deploys it and has to tell whether it's working |

Then add a row to the index table in `documents/README.md`.

**What actually needs to be in there.** The diff already says what changed — the
document exists for what the diff *can't* say:

- **The failure, concretely.** What the user saw, ideally verbatim (the message the bot
  sent, the wrong number on the page). "Improved context handling" documents nothing.
- **The root cause, not the symptom.** Which line, which assumption, why it was written
  that way in the first place.
- **The approach that looked obvious and was wrong.** This is the highest-value
  paragraph in the file: it's what stops the next agent re-litigating a settled
  question. `021`'s "don't reintroduce `interrupt()`" note and `037`'s "the LangGraph
  checkpointer is not conversation memory" note are both this.
- **Deliberate narrowness.** A rule that's tight on purpose reads like an oversight six
  months later, and someone "fixes" it. Say why it's tight.
- **What you didn't do.** Scope you consciously left — with enough detail that picking
  it up doesn't mean rediscovering the problem.

**Verification claims must be honest.** If the tests couldn't run in your environment,
the document says so and says what you did instead. A `release.md` that implies
verification that never happened is worse than no document.

**Not every PR is a feature.** A one-line typo fix or a comment change doesn't need a
folder. A behaviour change, a schema change, a new module, a bug fix with a non-obvious
cause, or anything that changes how the bot talks to a household does. When unsure:
write it.

**This is separate from, and additional to, "Keep This File in Sync" above.** `CLAUDE.md`
is the map of what the system *is now*; `documents/` is the record of how it got that
way and what was ruled out. Neither substitutes for the other, and a PR that needs both
ships both.

Note how the *last twelve* features (025–036) shipped with no entry at all — that gap is
recorded at the bottom of `documents/README.md`'s index. Their reasoning is now only
recoverable from commit messages. Don't add to it.

---

## Task ID & Branch Naming Convention

All work is tracked by task IDs (e.g. `010`, `011`). Use the format:

- **Branch**: `claude/task-<ID>-short-description` (e.g. `claude/task-010-platform-shell`)
- **PR title**: `[Task 010] Platform Shell + Insurance App`
- **Commit prefix**: `[010]` (e.g. `[010] Add insurance router`)

---

## Stack

| Layer | Technology | Where it runs |
|-------|-----------|---------------|
| Frontend | Next.js, React, TypeScript, Tailwind CSS | Vercel |
| Backend | FastAPI, Python 3.11, uvicorn | Railway |
| Database | Supabase (PostgreSQL) | Supabase Cloud |
| Auth | Supabase Auth (JWT) | Supabase Cloud |
| WhatsApp bot | Node.js, Baileys (WA multi-device) | Railway (separate service) |
| LLM (vision) | OpenRouter (vision model for receipt OCR) | OpenRouter API |

---

## Project Structure

```
homly/
├── CLAUDE.md
├── backend/
│   ├── api/
│   │   ├── main.py                  # FastAPI app, CORS, middleware registration, router mounting
│   │   ├── middleware/
│   │   │   └── auth.py              # JWT auth middleware (Supabase JWKS + service key bypass)
│   │   ├── dependencies/
│   │   │   └── limiter.py           # slowapi rate limiter instance
│   │   └── routers/
│   │       ├── expenses.py          # POST /process-receipt, GET /weeks, /this-week, /summary/last7days, etc.
│   │       ├── households.py        # GET/POST /household, /household/members, invites, auth/accept-invite
│   │       ├── settings.py          # GET/PATCH /settings, GET /internal/settings (bot)
│   │       ├── messages.py          # POST /messages/send, GET /internal/messages (bot polling)
│   │       ├── internal.py          # POST /internal/qr, /internal/connected, GET /internal/qr-status
│   │       ├── setup.py             # GET /setup/state, POST /setup/group, /setup/reset-qr, SSE /setup/qr-stream
│   │       ├── insurance.py         # GET/POST/PUT/DELETE /insurance, GET /internal/insurance/renewals
│   │       ├── tasks.py             # GET/POST/PATCH/DELETE /tasks (chores), /tasks/leave-requests,
│   │       │                        #   /tasks/helper-profile, /tasks/onboarding/suggest+confirm
│   │       ├── mcp_data.py          # GET /mcp/data/* — per-household-key-authenticated data-query endpoints
│   │       └── mcp_keys.py          # GET/POST/DELETE /mcp/keys — JWT-authenticated, generate/revoke MCP keys
│   │       # NOTE: analytics.py, admin.py, budgets.py, insights.py, recipe.py, pantry.py, waitlist.py,
│   │       # reminders.py, commands.py, savings.py, reimbursements.py also exist — see `ls backend/api/routers`
│   ├── mcp_server/                 # MCP server, two transports over the same tools/data:
│   │   ├── server.py               #   local stdio (backend/mcp_server/README.md) — calls /mcp/data/* over HTTP
│   │   └── remote.py               #   remote Streamable HTTP, mounted into api/main.py at /mcp/server/{key} —
│   │                               #   runs in-process against services/mcp_queries.py, no HTTP round-trip
│   ├── agents/
│   │   ├── receipt_agent.py        # Vision LLM call → structured JSON receipt data
│   │   ├── homly_graph.py          # LangGraph state machine: classifies + routes every WhatsApp message
│   │   ├── orchestrator/           # Chat-query supervisor: registry.py's AGENTS list is the
│   │   │   ├── supervisor.py       #   extensibility point — add an agent there and it's routable
│   │   │   └── react_loop.py       # Shared agent⇄tools loop skeleton (bind, invoke, route, iterate)
│   │   │                           #   used by both supervisor.py and proactive_agent.py, so a fix to
│   │   │                           #   iteration/routing logic can't drift between the two
│   │   ├── proactive_agent.py      # Same Reason/Act/Observe loop as orchestrator/, run unprompted on a
│   │   │                           #   schedule instead of in response to a message — see Proactive
│   │   │                           #   Household Monitor flow below
│   │   └── query/                  # One BaseQueryAgent per domain (pantry, insurance, savings,
│   │       └── tasks_agent.py      #   grocery, budgets, reminders, tasks, preferences) — tasks_agent.py
│   │                               #   handles chore assignment, completion, shopping-list adds, and leave
│   │                               #   requests via chat; budget_agent.py compares spend to monthly budget
│   │                               #   targets; reminders_agent.py lists upcoming reminders;
│   │                               #   preferences_agent.py remembers/lists/forgets standing
│   │                               #   household- or person-scoped preferences (services/preferences.py)
│   ├── services/
│   │   ├── db.py                   # get_supabase() — THE Supabase client. Every router, service
│   │   │                           #   and agent uses it; nothing else calls create_client().
│   │   │                           #   Wraps httpx with a retry transport, because Supabase's edge
│   │   │                           #   closes a pooled HTTP/2 connection after a couple of requests
│   │   │                           #   and the next call on it used to surface as a dashboard 500
│   │   ├── llm_client.py           # Facade: get_completion(), get_vision_completion()
│   │   ├── reimbursement.py        # get_reimbursable() — shared by /process-receipt and the WA webhook;
│   │   │                          #   compute_reimbursement_totals()/mark_receipts_reimbursed() — single
│   │   │                          #   source of truth for reimbursement totals and for marking receipts
│   │   │                          #   paid (receipts.reimbursement_id), used by expenses.py, messages.py,
│   │   │                          #   reimbursements.py, and homly_graph.py's payment_confirm_node
│   │   ├── receipts.py             # compute_category_totals() — shared item-category aggregation
│   │   ├── price_history.py        # compute_price_insights() — shared price-trend/best-vendor math
│   │   ├── pantry_confirmations.py # pending "add these to your pantry?" prompts, keyed by group_jid
│   │   ├── conversation.py         # the group's rolling chat transcript — the assistant's short-term
│   │   │                           #   memory. Owns what counts as "the current conversation"
│   │   │                           #   (how many turns, how old, is the bot still awaiting a reply);
│   │   │                           #   read by internal.py before every graph run, written by it and
│   │   │                           #   by whatsapp_client.py on every bot-initiated send
│   │   ├── preferences.py          # get/upsert/delete_preference() + format_for_prompt() — folded into
│   │   │                           #   both orchestrator/supervisor.py's and proactive_agent.py's system
│   │   │                           #   prompts on every run; backs agents/query/preferences_agent.py
│   │   ├── proactive_notifications.py  # dedup log for proactive_agent.py's notify_household tool —
│   │   │                           #   was_recently_notified()/record_notified(), keyed by finding_key
│   │   ├── bot_profile.py          # per-household assistant config: persona (name/tone/casual chat)
│   │   │                           #   folded into both agent system prompts, and should_engage() —
│   │   │                           #   the single rule for whether a group message gets a reply at all
│   │   ├── mcp_auth.py             # generate_key()/hash_key()/SCOPE — shared by mcp_keys.py and mcp_data.py
│   │   ├── mcp_queries.py          # the actual data fetching behind every MCP tool — shared by mcp_data.py
│   │   │                           # (HTTP, for the local stdio server) and mcp_server/remote.py (in-process)
│   │   ├── chores.py               # chore_due_today() — shared by tasks.py, tasks_agent.py, whatsapp_scheduler.py
│   │   ├── shopping_list.py        # add_auto_item() — shared by recipe.py, homly_graph.py, pantry_agent.py, tasks_agent.py
│   │   └── whatsapp_scheduler.py   # APScheduler cron jobs: weekly summaries, insurance renewals,
│   │                               #   daily tasks, proactive household checks (08:00 SGT)
│   ├── alembic/                    # Migration runner — see backend/migrations/README.md
│   │   ├── env.py                  # reads SUPABASE_DB_URL, no ORM target_metadata (pure-SQL migrations)
│   │   ├── script.py.mako          # template for `alembic revision`; downgrade() raises by default
│   │   └── versions/               # one revision per file below, chained by explicit parent pointer
│   ├── migrations/                 # source-of-truth .sql, applied via `alembic upgrade head`, not by hand
│   │   ├── README.md               # why Alembic, how to adopt it on an existing DB, how to add a migration
│   │   ├── 001_homly.sql           # Base schema: receipts, items, weekly views
│   │   ├── 002_soft_delete.sql     # deleted flag on receipts
│   │   ├── 003_settings.sql        # settings table per household
│   │   ├── 004_sender.sql          # sender_name, sender_phone on receipts
│   │   ├── 006_multi_tenant.sql    # households, household_members, invites tables
│   │   ├── 007_group_jid.sql       # group_jid on settings, user_id nullable on receipts
│   │   ├── 013_reimbursement.sql   # reimbursable flag on receipts, reimbursements table, settings columns
│   │   ├── 014_image_storage.sql   # image_path on receipts, Supabase Storage
│   │   ├── 015_insurance_policies.sql  # insurance_policies table with RLS
│   │   ├── ...                     # 016-029 — see `ls backend/migrations`
│   │   ├── 030_household_tasks.sql # chores, chore_logs, helper_leave_requests, helper_profile;
│   │   │                           #   extends shopping_list.added_by to include 'helper'
│   │   ├── 030_pantry_pending_confirmations.sql  # open "add to pantry?" prompts, keyed by group_jid
│   │   ├── 031_proactive_notifications.sql  # dedup log for the proactive monitor's notify_household tool
│   │   ├── 032_household_preferences.sql    # standing household/personal preferences, see services/preferences.py
│   │   ├── 033_reimbursement_receipt_link.sql  # receipts.reimbursement_id — single source of truth for
│   │   │                                    #   "is this receipt paid", replacing the old (year, week_number)
│   │   │                                    #   match against `reimbursements` — see services/reimbursement.py
│   │   ├── 034_bot_personality.sql   # bot_name/tone/engagement_mode/casual_chat/proactive on settings
│   │   ├── 035_conversation_messages.sql  # per-group chat transcript, see services/conversation.py
│   │   └── 036_waitlist_variant.sql  # waitlist.variant — which landing-page hero a signup came from,
│   │                                 #   so the headline A/B test is settled by conversion data
│   ├── tests/                      # pytest suite — see Testing & CI below
│   │   ├── conftest.py             # placeholder_env / fake_supabase / api_client fixtures
│   │   ├── fakes.py                # THE FakeSupabase + assert_scoped_to(); don't hand-roll another
│   │   └── check_household_scoping.py  # AST scan for unscoped queries (run as a script, not pytest)
│   ├── alembic.ini
│   ├── pytest.ini                  # testpaths = tests, pythonpath = .
│   ├── requirements.txt
│   ├── requirements-dev.txt        # requirements.txt + pinned pytest & ruff; what CI installs
│   └── whatsapp/                   # Standalone Node.js WhatsApp bot (Baileys)
│       ├── index.js                # Connects, forwards every message to /internal/graph-invoke
│       ├── lib/
│       │   ├── parsing.js          # Pure helpers: stripLeadingMentions, wasBotMentioned,
│       │   │                       #   isReplyToBot, ownPhone, parseRemindDuration
│       │   └── parsing.test.js     # `node --test` — no dependencies, runs without npm install
│       ├── package.json
│       └── .env                    # FASTAPI_URL, SUPABASE_KEY, INTERNAL_KEY
└── frontend/
│   ├── vitest.config.ts            # environment: node; `@/*` alias mirrors tsconfig.json
│   ├── config/
│   │   └── apps.ts                 # Central app/nav config (single source of truth for shell nav)
│   │                               #   apps.test.ts checks every nav href against the routes on disk
│   ├── app/
│   │   ├── page.tsx                # Landing page
│   │   ├── login/page.tsx          # Login
│   │   ├── onboarding/page.tsx     # Household creation / invite acceptance
│   │   ├── dashboard/page.tsx      # → redirects to /expenses
│   │   ├── history/page.tsx        # → redirects to /expenses/transactions
│   │   ├── analytics/page.tsx      # → redirects to /expenses/summary
│   │   ├── admin/page.tsx          # → redirects to /admin (legacy, kept for backwards compat)
│   │   ├── (shell)/                # Route group: platform shell layout (no URL prefix)
│   │   │   ├── layout.tsx          # Shell: auth guard, Rail + Subnav + Topbar + BottomTabBar
│   │   │   ├── expenses/
│   │   │   │   ├── page.tsx        # Weekly expense overview, ReceiptDrawer
│   │   │   │   ├── transactions/page.tsx  # Accordion week history
│   │   │   │   ├── members/page.tsx       # Household members + invite
│   │   │   │   ├── summary/page.tsx       # Analytics: charts, categories, vendors
│   │   │   │   └── insights/page.tsx      # Price intelligence: comparison, trends
│   │   │   ├── insurance/
│   │   │   │   ├── page.tsx        # Policies list + add/edit modal
│   │   │   │   └── renewals/page.tsx  # Renewal countdown sorted by date
│   │   │   ├── chores/
│   │   │   │   ├── page.tsx        # Today's chores + mark done/skipped, add-task modal
│   │   │   │   ├── setup/page.tsx  # Agent-assisted onboarding wizard (chores + helper off-days)
│   │   │   │   ├── history/page.tsx   # Completed/skipped chore log, date-range filter
│   │   │   │   └── leave/page.tsx     # Helper leave requests + admin approve/deny
│   │   │   ├── admin/page.tsx      # Super-admin: households, invites, price intelligence
│   │   │   ├── settings/page.tsx   # Household settings (schedule, reimbursement, WhatsApp)
│   │   │   └── setup/page.tsx      # WhatsApp QR scan + group selection
│   │   └── components/
│   │       ├── Navbar.tsx          # Legacy navbar (landing/login pages only)
│   │       ├── Toast.tsx
│   │       └── shell/
│   │           ├── Rail.tsx        # 64px dark icon rail (md+), shows admin icon for super admins
│   │           ├── Subnav.tsx      # 200px dark subnav (lg+), WhatsApp status badge
│   │           ├── Topbar.tsx      # 56px dark topbar with page title + sign out button
│   │           ├── BottomTabBar.tsx # Fixed bottom nav (mobile only)
│   │           └── icons.tsx       # SVG icon components (AppIcon, AdminIcon, etc.)
│   └── lib/
│       ├── dates.ts                # Shared week/date maths — was duplicated across four pages.
│       │                           #   Staging post before this moves to the backend, not a home
│       ├── insurance.ts            # monthlyPremium() — same story
│       ├── supabase.ts             # Supabase browser client
│       ├── apiUrl.ts               # API_URL — NEXT_PUBLIC_API_URL with trailing slashes stripped.
│       │                           #   Anything building a backend URL by hand imports this
│       ├── axios.ts                # Shared axios instance with auth interceptor (baseURL = API_URL)
│       └── toast.ts                # useToast hook
```

---

## Architecture

### Platform Shell

The frontend uses a **two-level shell** layout for all authenticated pages:

```
┌──────────────────────────────────────────────────────┐
│  Rail (64px)  │  Subnav (200px)  │  Topbar (56px)   │
│  dark icons   │  dark list       │  title + signout  │
│  md+          │  lg+             │  always visible   │
├───────────────┴──────────────────┴───────────────────┤
│                   Page content                        │
├──────────────────────────────────────────────────────┤
│           BottomTabBar (mobile, md:hidden)            │
└──────────────────────────────────────────────────────┘
```

- **Rail** (`app/components/shell/Rail.tsx`): 64px dark rail. Shows app icons from `config/apps.ts`. Admin icon only shown to `is_super_admin` users.
- **Subnav** (`app/components/shell/Subnav.tsx`): 200px dark sidebar, visible lg+. Per-app nav items, WhatsApp connection badge.
- **Topbar** (`app/components/shell/Topbar.tsx`): 56px dark header. Shows page title + user email + Sign Out button (top-right).
- **BottomTabBar** (`app/components/shell/BottomTabBar.tsx`): Fixed bottom nav on mobile. Shows admin tab for super admins.
- **Mobile pills**: Horizontal scrollable sub-nav pills appear below topbar on md- (hidden on lg+).

All shell pages use **dark stone theme**: `bg-[#0f0e0c]` body, `bg-stone-900` cards, `border-stone-800` borders, `text-stone-100/300/400/500` text hierarchy.

### Apps Config (`config/apps.ts`)

Single source of truth for shell navigation. Each `App` has: `id`, `label`, `icon`, `color`, `accent`, `href`, `nav[]`, `actionLabel?`, `superAdminOnly?`.

Current apps (see `config/apps.ts` for the full, current nav list per app — the summary
below is illustrative, not exhaustive):
- `expenses` — color `#10B981`, nav includes Overview, Pantry, History, Members, Analytics, Insights, Budgets, Price Intelligence, Reimburse, Commands
- `insurance` — color `#3B82F6`, nav: Policies, Renewals, Coverage, Gaps
- `savings` — color `#10B981`, nav: Overview, History
- `chores` — color `#10B981`, nav: Today, History, Leave; first visit with no `helper_profile.onboarded_at` redirects to `/chores/setup`
- `admin` — color `#F59E0B`, nav: Overview, Price Intelligence; `superAdminOnly: true`

### Multi-Tenancy Model

All data is scoped by `household_id`. A household has:
- One or more **members** (via `household_members` table, roles: `admin` / `member`)
- One **settings** row (summary schedule, WhatsApp group JID)
- Many **receipts**, **items**, and **insurance_policies**

The WhatsApp bot authenticates with the **Supabase service role key** (never expires) instead of per-user JWTs. The bot identifies which household to write to by looking up the incoming group's JID in the `settings.group_jid` column.

### Insurance Flow

```
User adds policy via /insurance page
    ↓
POST /insurance (JWT auth) → inserted with household_id + created_by
    ↓
GET /insurance → list active policies for household

Daily 09:00 SGT cron in WhatsApp bot:
    GET /internal/insurance/renewals (X-Internal-Key)
    → returns policies renewing in 7 or 30 days
    → sends reminder to household group JID
```

### Household Tasks & Helper Flow

```
Onboarding (dashboard, one-time per household):
    Family describes helper's typical week in free text on /chores/setup
        ↓
    POST /tasks/onboarding/suggest → get_completion() (services/llm_client.py)
        → LLM proposes starter chores + recurring off-days (not yet saved)
        ↓
    Family reviews/edits the suggestion in the wizard
        ↓
    POST /tasks/onboarding/confirm → bulk-inserts chores, upserts helper_profile
        (onboarded_at set — /chores stops redirecting to /chores/setup)

Ongoing (same shared WhatsApp group — no separate helper channel):
    Family or helper types in the group (e.g. "mark laundry done", "helper needs
    off next Tuesday", "assign mop the floor daily")
        ↓
    /internal/graph-invoke → homly_graph.py's query_node/pantry_node
        → agents/orchestrator (LangGraph supervisor) → query_tasks tool
        → agents/query/tasks_agent.py (chore_logs / chores / helper_leave_requests)
        (sender_name/sender_phone threaded through from the WhatsApp message for
        attribution — see agents/base_agent.py's handle() signature)

Daily 07:00 SGT cron (services/whatsapp_scheduler.py, in-process, no HTTP hop):
    _send_daily_tasks() finds each household's chores due today (services/chores.py's
    chore_due_today()) minus anything already logged, skips households whose
    helper_profile.off_days includes today, composes the message via get_completion()
    (falls back to a plain list if the LLM call fails), send_text(group_jid, msg)

Signal-driven auto-add (no human has to type it):
    Pantry item marked out_of_stock (dashboard PATCH /pantry/{name} or the pantry
    chat agent) → services/shopping_list.py's add_auto_item() immediately upserts
    it onto the shopping_list table (same helper used by recipe.py's dish-scan flow
    and the tasks chat agent's add_shopping_item intent)
```

### Receipt Flow

```
WhatsApp group message (image)
    ↓
Bot: downloadMediaMessage → FormData with household_id
    ↓
POST /process-receipt (service key auth)
    ↓
receipt_agent.py: get_vision_completion() → structured JSON
    ↓
Insert into receipts + items tables (scoped to household_id)
    ↓
Bot reacts ✅ to message; flags receipt in chat if confidence = low
```

### MCP Data-Query Flow

```
User: Settings → MCP → Generate key (JWT auth)
    ↓
POST /mcp/keys (api/routers/mcp_keys.py) → plaintext key shown once, only its
    SHA-256 hash is stored in api_keys (scope='mcp'), scoped to household_id
```

Two transports share that same key and the same tool set/data (`services/mcp_queries.py`):

```
Local (stdio) — Claude Code / Claude Desktop launch a Python subprocess:
Claude (MCP client)
    ↓ stdio
backend/mcp_server/server.py (FastMCP tools: list_weeks, search_receipts, etc.)
    ↓ HTTP, Authorization: Bearer <HOMLY_MCP_KEY>
GET /mcp/data/* (api/routers/mcp_data.py)
    ↓ resolve_household_id(key): hash it, look up api_keys where scope='mcp'
    ↓ then call services/mcp_queries.py
Supabase

Remote (Streamable HTTP) — "Add custom connector" on claude.ai, no local process:
Claude (MCP client)
    ↓ HTTPS to https://<backend>/mcp/server/<HOMLY_MCP_KEY>/ (trailing slash —
    ↓  without it every request 307-redirects to add one)
    ↓ (the key is a URL path segment, not a header — that connector dialog
    ↓  has no field for custom headers/bearer tokens)
mcp_server/remote.py, mounted into api/main.py at /mcp/server/{key}
    ↓ per tool call: read the key from the request's path params
    ↓ (Context.request_context.request.path_params), resolve_household_id(key)
    ↓ then call services/mcp_queries.py directly — same functions as above,
    ↓  but in-process (no HTTP round-trip to itself)
Supabase
```

Lets an AI tool query and analyse one household's expenses/budgets/insurance/price
history directly. Each key is single-household-scoped and independently revocable
(unlike the WhatsApp bot's shared `INTERNAL_KEY`, which is a first-party
server-to-server secret with access to every household) — revoking one takes
effect on the very next request on either transport. See
`backend/mcp_server/README.md` for setup.

### Pantry Confirmation Flow (grocery receipts + fridge scans)

Do **not** reintroduce LangGraph's `interrupt()` here. It was used originally on
the assumption that the next `g.invoke(state, config)` on the same `thread_id`
would resume the suspended run — it does not; invoking with a fresh input dict
starts a new run from the entry point, so `resume_from_confirmation_node` was
unreachable. `interrupt()` also requires a checkpointer, and `get_graph()`
silently falls back to a stateless graph when `SUPABASE_DB_URL` is unset, where
it raises *after* the prompt has already been queued — the group saw the item
list and then nothing.

The prompt and the reply are two independent graph runs, joined by a row in
`pantry_pending_confirmations`:

```
Grocery receipt (or fridge scan) saved
    ↓
extract_pantry_candidates → send_pantry_confirmation
    ↓  save_pending(group_jid, candidates)   ← persisted BEFORE the message goes out
    ↓  send_text_sync("Add these items to your pantry?")
    ↓  END — this run is finished

...group replies "yes" / "no" / "1,3,5" / an item name...
    ↓
classify_node: a live pending row for this group_jid + the text reads like an
    answer (_looks_like_confirmation) → message_type = "pantry_confirmation"
    ↓  an unrelated question while a prompt is open falls through to normal
    ↓  classification instead of being swallowed as an answer
resume_from_confirmation (reads candidates from the row, clears it)
    → update_pantry → confirm_to_user → synthesise
```

### Weekly Summary Flow

```
node-cron (per-household schedule from settings)
    ↓
GET /summary/last7days?household_id=... (service key auth)
    ↓
Format message with receipts, category totals, flagged count
    ↓
sock.sendMessage(groupJid, { text: ... })
```

### Assistant Engagement Flow (when the bot is allowed to speak)

The bot lives in the household's **shared** WhatsApp group, so `/internal/graph-invoke`
receives every message members send *each other*, not just the ones meant for it. Two
separate decisions therefore sit in `homly_graph.py`'s `classify_node`: what kind of
message this is, and whether to answer it at all.

```
classify_node (text and images both go through this gate)
    ↓
addressed = was_mentioned OR is_reply_to_bot OR bot_profile.mentions_name(text/caption, bot_name)
            OR conversation.is_awaiting_reply(context)
    ↑ the first two come from whatsapp/index.js, which knows its own JID; the
    ↑ backend adds the name check because bot_name is per-household — for an
    ↑ image this checks the caption, since that's the only text that exists
    ↑ the fourth is conversational continuity: the bot spoke last, recently,
    ↑ with nothing said in between, so this message is a reply to it (people
    ↑ don't re-@mention an assistant mid-conversation) — see Conversation
    ↑ Memory Flow below
    ↓
services/bot_profile.should_engage(message_type, profile, addressed)
    ↓                                        ↓
  True → route_by_type sends it on;    False → "silent" → END
  an "unknown" message_type is
  rerouted to the query node
```

`should_engage` is the **only** place this rule lives — don't re-derive it in a caller.
Its three modes (`settings.bot_engagement_mode`):

| Mode | Answers |
|------|---------|
| `mentioned` | only when addressed |
| `smart` (default) | when addressed, **or** when the message classified as `text_query` / `pantry_command` |
| `always` | every message |

Receipts, recipes, fridge scans, `pantry_confirmation` and `payment_confirmation` bypass
the gate in every mode (`_ALWAYS_ENGAGE`) — each is a deliberate, unambiguous action, and
swallowing a pantry confirmation in particular would strand the flow with a prompt nobody
can close. An **unrecognized photo** (`other_image` — a family photo, a meme, a screenshot)
is *not* in that set and is gated exactly like unaddressed text chatter: in `mentioned`
mode it's silently ignored unless the caption addresses the bot. This used to be a bug —
`classify_node`'s image branch hardcoded `engage: True` for every photo regardless of mode,
so the bot spoke up on any photo shared in the group. When an unrecognized photo *does*
engage, it gets a fixed honest reply from `unsupported_image_node` rather than being routed
into the chat orchestrator — `run_query()` has no way to see the photo itself, only whatever
caption text came with it, so answering as if it had would just be a confident guess.

Text classification (`_classify_text` in `homly_graph.py`) is LLM-first: a single cheap
`get_completion()` call sorts a message into `pantry_command` / `text_query` / `unknown`
(payment confirmations still match a fixed exact-phrase set — `_PAYMENT_EXACT` — before the
model is even called, since that one's deterministic and cheap). If the model call fails,
times out (`_TEXT_CLASSIFY_TIMEOUT_SECONDS`), or returns a type outside that set,
`_classify_text_keywords()` — the original fixed prefix/suffix keyword match — is the
fallback, so a single bad LLM call never blocks message handling. `tests/test_classify_text.py`
covers both layers, plus a small eval set against the keyword fallback.

**Why `unknown` reroutes to the orchestrator instead of `END`:** even the LLM classifier
only sorts a message into a handful of buckets, so ordinary conversation ("morning!",
"thanks!") reliably lands in `unknown` rather than matching one of the actionable types —
and the group must not get silence from something that presents itself as an assistant. The
orchestrator cannot go silent — `force_finalize_node` (now shared via
`agents/orchestrator/react_loop.py`, see below) strips its tools and forces a text answer,
and `run_query()` falls back to a fixed string — so handing it the message is what makes
"always responds" true. **Don't add a new silent path out of `classify_node`.**

### Conversation Memory Flow (how the assistant retains context)

The WhatsApp bot makes **one stateless HTTP request per message**
(`/internal/graph-invoke`), so nothing about a conversation survives between messages
on its own. `run_query()` has always taken a `context` argument; the WhatsApp entry
point hard-coded it to `[]` and nothing ever wrote a turn down, so the assistant
reasoned about every message in total isolation — it answered a reply to its *own*
message with "that's a big reaction for no context", and couldn't resolve a follow-up
like "how much then?".

`conversation_messages` (migration `035`) is the transcript that fixes that, and
`services/conversation.py` is the **only** place the "what counts as the current
conversation" rules live (how many turns, how old, whether the bot is still awaiting a
reply). Don't re-derive them in a caller.

```
Inbound — api/routers/internal.py's /internal/graph-invoke:
    conversation.get_context(household_id, group_jid)   ← BEFORE recording this message,
    ↓                                                     so it appears once, as the query
    conversation.record_user_message(...)                 (role='user', every message —
    ↓                                                      including ones the engagement
    ↓                                                      gate won't answer: that chatter
    ↓                                                      is the conversation it sits in)
    graph.invoke(state with context=…)
        ↓ classify_node reads it twice:
        ↓   _classify_text(query, context)  — a follow-up ("and last month?") is classified
        ↓     by what it follows up on; the keyword fallback stays context-free on purpose
        ↓   _is_follow_up(state)            — the fourth `addressed` signal above
        ↓ query_node / pantry_node pass it to run_query(context=…), which folds it into the
        ↓   supervisor's message list ahead of the current question (_to_lc_messages)
    ↓
    conversation.record_assistant_message(...) if the run produced a response

Outbound the bot initiates (pantry prompts, weekly summaries, renewal reminders,
proactive notifications, POST /messages/send) doesn't come back through that response,
so it's recorded at the one choke point they all pass through:
    services/whatsapp_client.py's send_text()/send_text_sync() → conversation.record_…
    (household_id optional there — resolve_household_id() maps the group JID)
```

Notes for anyone touching this:

* **The LangGraph checkpointer is not this.** `get_graph(with_memory=True)` persists
  *graph state* per thread, and `classify_node` deliberately wipes the per-message
  fields on every run (`_RUN_RESET`). It was never a transcript, and it silently falls
  back to a stateless graph when `SUPABASE_DB_URL` is unset.
* A user turn is stored with the sender's name and rendered as `"Aditya: …"` — a group
  has more than two speakers, so who said it is part of the message.
* `POST /query` (dashboard) supplies its own `context`; nothing in the graph overwrites
  what a caller passed in.
* Every failure here degrades to "no memory", never to a dropped message.

### Proactive Household Monitor Flow

Every other agent in this codebase is reactive — it only runs because a household member
sent a WhatsApp message. `agents/proactive_agent.py` is the one exception: the same
Reason/Act/Observe (ReAct) loop shape as `agents/orchestrator/supervisor.py`, run
unprompted on a schedule instead of triggered by a message.

Both loops are now built on the shared skeleton in `agents/orchestrator/react_loop.py`
(`make_agent_node`, `build_react_graph`) — the agent⇄tools wiring and iteration/routing
logic used to be implemented twice and could silently drift between the two callers.
What each loop still owns independently: its own `tools_node` (this loop's dispatches only
to the read-only intents below, plus `notify_household`/`no_action`; the supervisor's
dispatches to any registered agent with sender attribution), its own system prompt builder,
and what happens at the iteration cap — this loop just ends (`on_exhausted="end"`, silence
is a fine outcome when nobody's waiting on an answer), where the chat supervisor forces a
text answer (`on_exhausted="force_finalize"`, see Assistant Engagement Flow above).

```
Daily 08:00 SGT cron (services/whatsapp_scheduler.py, in-process, no HTTP hop):
    _run_proactive_checks() loads every household with a connected group_jid
    ↓ per household, on a thread (LLM + Supabase calls are blocking):
    agents/proactive_agent.run_proactive_check(household_id, group_jid)
        ↓
      LangGraph loop (agents/orchestrator/react_loop.build_react_graph):
      agent_node (LLM + tool-bound) ⇄ tools_node, up to 8 iterations
        ↓ agent_node reasons about what to check; tools_node executes the call and
        ↓ feeds the result back as the next observation
      Tools available are a READ-ONLY SUBSET of agents/orchestrator/registry.py's
      AGENTS — see proactive_agent._READONLY_INTENTS. An agent whose tools can also
      write (pantry add/mark, budget set_budget, task assign/mark/leave) only exposes
      its read intents here; the model cannot mutate household data on an unattended
      run. This is enforced in tools_node itself, not just by the system prompt.
        ↓
      Two more tools end the loop:
        - notify_household(finding_key, message) → services/proactive_notifications.py
          checks the finding_key wasn't already sent within the last 24h (dedup log —
          see `proactive_notification_log` below), then send_text_sync()
        - no_action() → checked, nothing worth surfacing this run (the common case)
```

Adding a new proactive check needs zero new code most of the time: any read intent
already registered in `agents/orchestrator/registry.py` becomes available here just by
adding its tool name (and, if the agent has writes too, the specific read intent names)
to `_READONLY_INTENTS`.

This loop is skipped entirely for a household with `settings.bot_proactive_enabled = false`
(checked in `whatsapp_scheduler._run_proactive_checks`, not inside the agent).

Both this loop's and the chat supervisor's system prompts are built per-run (not a
static string) — `_build_system_prompt()` in each folds in the household's remembered
preferences (`services/preferences.py`) and its assistant persona
(`services/bot_profile.describe_for_prompt()` — name and tone; this loop passes
`include_chat_guidance=False`, since nothing is talking to it on a scheduled run), and the
chat supervisor's also folds in the sender's name, so responses read like a household
assistant that knows who it's talking to rather than a stateless data lookup. `agents/query/preferences_agent.py`
is how a household member adds to that memory ("remember I don't eat pork") — it's a
normal registered agent, callable like any other from either loop.

### QR Code Regeneration Flow

```
User clicks "Generate QR" on setup page
    ↓
POST /setup/reset-qr
  → whatsapp_state["qr"] = None        (shows spinner in frontend)
  → whatsapp_state["qr_requested"] = True
    ↓
Bot polls GET /internal/qr-status every 5s
  → sees qr_requested = true
  → calls currentSock.end()            (triggers reconnect)
    ↓
Baileys reconnects → fires qr event → bot pushes new QR to /internal/qr
    ↓
Frontend polling picks up new QR within 3s
```

---

## Database Schema

### `households`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| name | TEXT | |
| plan | TEXT | DEFAULT 'free' |
| active | BOOLEAN | |
| created_at / updated_at | TIMESTAMPTZ | |

### `household_members`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| user_id | UUID (FK → auth.users) | |
| role | TEXT | 'admin' or 'member' |
| invited_by | UUID | |
| joined_at | TIMESTAMPTZ | |
| | | UNIQUE(household_id, user_id) |

### `receipts`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| user_id | UUID (nullable FK → auth.users) | NULL for bot-submitted receipts |
| household_id | UUID (FK → households) | |
| vendor | TEXT | |
| date | DATE | |
| subtotal / tax / total | NUMERIC(10,2) | |
| currency | TEXT | DEFAULT 'SGD' |
| confidence | TEXT | 'high' / 'medium' / 'low' |
| flagged | BOOLEAN | true if low confidence or no total |
| deleted | BOOLEAN | soft delete |
| whatsapp_message_id | TEXT (UNIQUE) | dedup key |
| sender_name / sender_phone | TEXT | who submitted via WhatsApp |
| week_number / year | INT | ISO week |
| image_path | TEXT | Supabase Storage path |
| reimbursable | BOOLEAN | DEFAULT true — whether this receipt counts toward reimbursement |
| reimbursement_id | UUID (nullable FK → reimbursements) | Set once this receipt has been paid — the single source of truth for "is this receipt paid" (see `reimbursements` below) |

### `items`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| receipt_id | UUID (FK → receipts) | CASCADE |
| household_id | UUID | |
| name | TEXT | |
| qty | NUMERIC | |
| unit_price / line_total | NUMERIC(10,2) | |
| category | TEXT | groceries / household / personal care / food & beverage / transport / other |
| vendor / receipt_date / week_number / year | | denormalised for fast queries |

### `settings`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (UNIQUE FK → households) | |
| summary_day | INT | 0=Mon … 6=Sun |
| summary_hour | INT | 0–23 |
| summary_timezone | TEXT | e.g. 'Asia/Singapore' |
| cutoff_mode | TEXT | 'last7days' or 'thisweek' |
| group_name | TEXT | WhatsApp group display name |
| group_jid | TEXT | WhatsApp group JID (e.g. `120363...@g.us`) — used for routing |
| bot_name | TEXT | DEFAULT `'Homly'`. Also an addressing signal — saying it counts as talking to the bot |
| bot_engagement_mode | TEXT | `mentioned` / `smart` / `always`, DEFAULT `'smart'`. See Assistant Engagement Flow |
| bot_tone | TEXT | `warm` / `concise` / `playful`, DEFAULT `'warm'` |
| bot_casual_chat | BOOLEAN | DEFAULT true — may answer small talk and give opinions outside household data |
| bot_proactive_enabled | BOOLEAN | DEFAULT true — gates the 08:00 proactive check in `whatsapp_scheduler.py` |
| updated_at | TIMESTAMPTZ | |

### `invites`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| email | TEXT | |
| household_id | UUID (nullable) | null = user creates own household |
| role | TEXT | 'admin' or 'member' |
| token | TEXT (UNIQUE) | invite link token |
| accepted | BOOLEAN | |
| expires_at | TIMESTAMPTZ | NOW() + 7 days |

### `reimbursements`
One row per reimbursement payment. `services/reimbursement.py`'s
`mark_receipts_reimbursed()` is the *only* code path allowed to insert here —
it always derives `amount` from the specific receipts being paid off and
stamps this row's id onto each of them via `receipts.reimbursement_id`, so a
payment can never drift from what it actually covers. `year`/`week_number`
are legacy (nullable) — a payment now typically covers a `start_date`/
`end_date` range that can span more than one ISO week (a household's custom
summary week, from `settings.summary_day`, doesn't line up with the ISO
Monday–Sunday grid). Deleting a row here cascades to `receipts.reimbursement_id
= NULL` on whatever it covered (`ON DELETE SET NULL`), making those receipts
outstanding again.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| year / week_number | INT (nullable) | Legacy — prefer `start_date`/`end_date` |
| start_date / end_date | DATE (nullable) | Date range of the receipts this payment covers |
| amount | NUMERIC(10,2) | Always derived from covered receipts, never typed in by a caller |
| paid_at | TIMESTAMPTZ | |
| note | TEXT | |
| created_by | UUID (FK → auth.users, nullable) | NULL for WhatsApp-initiated payments |
| created_at | TIMESTAMPTZ | |

### `insurance_policies`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| provider | TEXT (NOT NULL) | |
| policy_number | TEXT | |
| coverage_type | TEXT | health / life / home / car / travel / other |
| insured_person | TEXT | |
| coverage_amount | NUMERIC | |
| premium_amount | NUMERIC | |
| premium_frequency | TEXT | monthly / quarterly / annually |
| renewal_date | DATE | |
| notes | TEXT | |
| is_active | BOOLEAN | DEFAULT true, soft-delete |
| created_by | UUID (FK → auth.users) | |
| created_at / updated_at | TIMESTAMPTZ | |

### `pantry_pending_confirmations`
Holds the "add these items to your pantry?" prompt while the WhatsApp group is
answering it. The bot makes one stateless HTTP request per message, so the
question and its reply are two separate graph runs — this row is what connects
them. `UNIQUE(group_jid)` means a newer receipt supersedes an unanswered older
prompt, matching what the group sees in the chat.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| group_jid | TEXT (UNIQUE) | one open prompt per group |
| receipt_id | UUID (FK → receipts) | NULL for fridge scans |
| source | TEXT | 'receipt' or 'fridge_scan' |
| candidates | JSONB | the items the group was asked about |
| created_at | TIMESTAMPTZ | |
| expires_at | TIMESTAMPTZ | DEFAULT NOW() + 24h — a stale "yes" is ignored |

### `proactive_notification_log`
Dedup log for `agents/proactive_agent.py`'s `notify_household` tool — see Proactive
Household Monitor Flow above. `UNIQUE(household_id, finding_key)` lets a notify call
upsert the same row on every repeat, so "was this finding already sent recently?" is a
single lookup rather than scanning history.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| finding_key | TEXT | Stable identifier the agent chooses, e.g. `budget_over:groceries:2026-08` |
| last_notified_at | TIMESTAMPTZ | Upserted on every send; checked against a 24h cooldown |

### `conversation_messages`
The rolling transcript of one WhatsApp group's chat — the assistant's short-term
memory, read and written through `services/conversation.py` only (see Conversation
Memory Flow above). Holds both directions: `role='user'` for every household member's
message (including ones the engagement gate chose not to answer) and `role='assistant'`
for everything the bot said into the group, whether it came back from
`/internal/graph-invoke` or was pushed out directly by `services/whatsapp_client.py`.
No retention job yet — reads are always bounded by a recency window and a row limit.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| group_jid | TEXT | The WhatsApp group this was said in |
| role | TEXT | `user` or `assistant` |
| content | TEXT | Message text; a photo is recorded as `[sent a photo] <caption>` |
| sender_name / sender_phone | TEXT | Who said it — NULL for the assistant |
| message_type | TEXT | `classify_node`'s verdict, when there was one |
| whatsapp_message_id | TEXT | UNIQUE per household where not null — a Baileys redelivery must not double up a turn |
| created_at | TIMESTAMPTZ | Ordering key, with `(household_id, group_jid, created_at DESC)` |

### `household_preferences`
Standing preferences the household or an individual member has told the bot to
remember (`services/preferences.py`) — folded into `orchestrator/supervisor.py`'s
and `proactive_agent.py`'s system prompts every run so the assistant doesn't start
cold. No DB-level unique constraint — `sender_phone IS NULL` (household-wide) rows
are deduped by an explicit check-then-write in `upsert_preference()` instead, since
a plain `UNIQUE` treats every `NULL` as distinct.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| sender_phone | TEXT (nullable) | NULL = applies to the whole household; else scoped to that person |
| key | TEXT | Short label, e.g. `diet`, `reminder_lead_time` |
| value | TEXT | The preference itself |
| created_at / updated_at | TIMESTAMPTZ | |

### `api_keys`
Generic per-household bearer-key table, not MCP-specific — `scope` distinguishes
which integration a key is for, so a future integration (a public API, Zapier,
etc.) can reuse this table instead of growing its own. Currently the only
`scope` in use is `'mcp'` (see `services/mcp_auth.py`).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| scope | TEXT | Which integration issued this key, e.g. `'mcp'`. DEFAULT `'mcp'` |
| key_hash | TEXT (UNIQUE) | SHA-256 of the plaintext key — plaintext is never stored |
| key_prefix | TEXT | First few chars, shown in the UI to tell keys apart |
| label | TEXT | Optional, set by the user at creation |
| created_by | UUID (FK → auth.users) | |
| created_at | TIMESTAMPTZ | |
| last_used_at | TIMESTAMPTZ | Updated on every successful `/mcp/data/*` call |
| revoked_at | TIMESTAMPTZ | NULL = active |

### `chores`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| title | TEXT | |
| notes | TEXT | |
| recurrence | TEXT | `once` / `daily` / `weekly` |
| days_of_week | INT[] | For `weekly`; 0=Mon..6=Sun, matches `settings.summary_day` convention |
| due_date | DATE | For `once` |
| active | BOOLEAN | Soft-delete/pause |
| source | TEXT | `dashboard` / `whatsapp` / `agent` |

### `chore_logs`
One row per completed/skipped occurrence — absence of a row for a given `(chore_id, log_date)` means still pending. See `services/chores.py`'s `chore_due_today()` for the recurrence-matching logic shared between the dashboard, the chat agent, and the daily cron.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| chore_id | UUID (FK → chores, CASCADE) | |
| household_id | UUID (FK → households) | |
| log_date | DATE | |
| status | TEXT | `done` / `skipped` |
| completed_by_name / completed_by_phone | TEXT | Attribution — from WhatsApp sender info or null for dashboard |
| source | TEXT | `dashboard` / `whatsapp` |
| | | UNIQUE(chore_id, log_date) |

### `helper_leave_requests`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (FK → households) | |
| start_date / end_date | DATE | |
| reason | TEXT | |
| status | TEXT | `pending` / `approved` / `denied` |
| requested_by_name / requested_by_phone | TEXT | |
| source | TEXT | `dashboard` / `whatsapp` |
| decided_by | UUID (FK → auth.users) | Admin who approved/denied |
| decided_at | TIMESTAMPTZ | |

### `helper_profile`
One row per household, captured at `/chores/setup` onboarding. Drives the daily-tasks cron's off-day skip and gives the onboarding-suggestion LLM call context.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| household_id | UUID (UNIQUE FK → households) | |
| has_helper | BOOLEAN | |
| helper_name | TEXT | |
| duties_description | TEXT | Raw free text from onboarding |
| off_days | INT[] | Recurring weekly off days, 0=Mon..6=Sun |
| onboarded_at | TIMESTAMPTZ | NULL = onboarding not yet completed; `/chores` redirects to `/chores/setup` until set |

---

## API Endpoints

### User-facing (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/household` | Get own household + members (includes email from auth) |
| POST | `/household` | Create household (first-time) |
| POST | `/household/members` | Invite member by email |
| PATCH | `/household/members/{user_id}` | Change member role |
| DELETE | `/household/members/{user_id}` | Remove member |
| POST | `/process-receipt` | Upload receipt image → OCR → save |
| GET | `/weeks` | List weeks with receipts |
| GET | `/weeks/{year}/{week_number}` | Week detail with receipts + category totals |
| GET | `/receipts/{receipt_id}` | Single receipt + items |
| PATCH | `/receipts/{receipt_id}/flag` | Toggle flagged |
| PATCH | `/receipts/{receipt_id}/delete` | Soft delete |
| GET | `/this-week` | Shortcut to current week |
| GET | `/summary/last7days` | Last 7 days receipts + totals |
| GET | `/settings` | Get household settings |
| PATCH | `/settings` | Update settings (incl. `group_jid`) |
| POST | `/messages/send` | Queue a WhatsApp message to household group |
| GET | `/insurance` | List active insurance policies |
| POST | `/insurance` | Create insurance policy |
| PUT | `/insurance/{id}` | Update insurance policy |
| DELETE | `/insurance/{id}` | Soft-delete (is_active = false) |
| GET | `/tasks` | List active chores, with `status_today`/`due_today` computed |
| POST | `/tasks` | Create a chore |
| PATCH | `/tasks/{id}` | Edit a chore, or pause/resume via `active` |
| DELETE | `/tasks/{id}` | Soft-delete (`active = false`) |
| POST | `/tasks/{id}/complete` | Mark today's occurrence done/skipped |
| GET | `/tasks/history` | `chore_logs` joined to `chores`, optional `from`/`to` date range |
| GET | `/tasks/leave-requests` | List helper leave requests |
| POST | `/tasks/leave-requests` | Log a leave request |
| PATCH | `/tasks/leave-requests/{id}` | Approve/deny (admin only) |
| GET | `/tasks/helper-profile` | Fetch the household's helper profile (used to gate the onboarding redirect) |
| POST | `/tasks/onboarding/suggest` | LLM call: free-text helper description → suggested chores + off-days (unsaved) |
| POST | `/tasks/onboarding/confirm` | Bulk-create the reviewed chores, upsert `helper_profile` with `onboarded_at` |

### Super-admin (JWT required, `is_super_admin = true`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/households` | List all households with member + receipt counts |
| PATCH | `/admin/households/{id}` | Update household (name, plan, active) |
| POST | `/admin/invite` | Send invite email |
| GET | `/admin/invites` | List all invites |
| DELETE | `/admin/invites/{id}` | Revoke invite |
| GET | `/admin/price-intelligence` | Cross-household price comparison + trends |

### MCP key management (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/mcp/keys` | List this household's MCP keys (id, label, prefix, timestamps — never the plaintext) |
| POST | `/mcp/keys` | Generate a new key (admin only). Response includes the plaintext once. |
| DELETE | `/mcp/keys/{key_id}` | Revoke a key (admin only) |

### Internal (service key or `X-Internal-Key` header — not JWT)

| Method | Path | Caller | Description |
|--------|------|--------|-------------|
| GET | `/internal/settings` | Bot | All households' settings array |
| POST | `/internal/qr` | Bot | Push QR data URL to backend state |
| POST | `/internal/connected` | Bot | Signal connected + push group list |
| GET | `/internal/qr-status` | Bot | Check/clear QR regeneration flag |
| GET | `/internal/messages` | Bot | Pop queued messages (clears queue) |
| GET | `/internal/insurance/renewals` | Bot | Policies renewing in 7 or 30 days |
| GET | `/internal/help` | Bot | Capabilities summary (`registry.build_help_text()`) for `/help` |
| POST | `/internal/graph-invoke` | Bot | Invoke `agents/homly_graph.py` for a WhatsApp message (text or image). Text calls also carry `sender_name`/`sender_phone`, `whatsapp_message_id`, and the `was_mentioned`/`is_reply_to_bot` addressing flags. Also loads and records the group's conversation transcript around the run — see Conversation Memory Flow |
| GET | `/internal/reminders/due` | Bot | Poll for due `/remind` reminders |
| GET | `/internal/commands` | Bot | Fetch custom command triggers, cached in the bot |

### MCP data query (per-household API key, not JWT or `X-Internal-Key`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/mcp/data/this-week` | Current ISO week's receipts + category totals |
| GET | `/mcp/data/last7days` | Trailing 7 days' receipts + category totals |
| GET | `/mcp/data/weeks` | List weeks with totals |
| GET | `/mcp/data/weeks/{year}/{week_number}` | Week detail: receipts + category totals |
| GET | `/mcp/data/receipts` | Search receipts (date range, vendor, flagged) |
| GET | `/mcp/data/receipts/{receipt_id}` | Single receipt + items |
| GET | `/mcp/data/vendors` | Top vendors by spend over a date range |
| GET | `/mcp/data/insurance` | Active insurance policies |
| GET | `/mcp/data/budgets` | Budgets, optionally by month |
| GET | `/mcp/data/price-history` | Price history + trend insights for an item (`canonical_name` query param) |

> `/mcp/data/*` takes `Authorization: Bearer <key>` where `<key>` is a value generated via
> `POST /mcp/keys`. There's no `household_id` request param anywhere on these routes —
> `api/routers/mcp_data.py`'s `_authenticate()` hashes the bearer token, looks it up in
> `api_keys` (scope `'mcp'`), and resolves `household_id` from that row. A revoked or unknown key gets 403.

### MCP remote server (Streamable HTTP, key in the URL path)

| Method | Path | Description |
|--------|------|-------------|
| ALL | `/mcp/server/{key}` | Streamable HTTP MCP endpoint — `{key}` is the same value `POST /mcp/keys` returns |

> Mounted via `mcp_server.remote.remote_mcp.streamable_http_app()` in `api/main.py`, exempted from
> `AuthMiddleware` by path prefix like `/mcp/data/*` is. Meant for pasting straight into Claude's
> "Add custom connector" dialog, which only accepts a URL — no header/bearer-token field — so the key
> has nowhere else to go. Same tools, same underlying data (`services/mcp_queries.py`) as the local
> stdio server; see the MCP Data-Query Flow diagram above.

### Setup (no auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/setup/state` | Current WhatsApp connection state |
| POST | `/setup/reset-qr` | Request QR regeneration |
| GET | `/setup/qr-stream` | SSE stream for QR / connected events |

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/accept-invite` | Accept invite token, join household |

---

## Authentication

### JWT Auth (regular users)

1. Frontend signs in via Supabase → gets JWT access token
2. `lib/axios.ts` interceptor attaches `Authorization: Bearer <token>` to every request
3. `AuthMiddleware` (JWKS-based) verifies the JWT, fetches the user's `household_id` from `household_members`, and sets `request.state.user`
4. On 401, the frontend interceptor signs out and redirects to `/login`

### Service Key Auth (WhatsApp bot)

The bot uses `SUPABASE_KEY` (service role key) as its bearer token. The middleware detects this and sets:
```python
request.state.user = {
    "sub": None,
    "household_id": None,   # endpoint reads from form/query
    "role": "service",
    "is_service_key": True,
}
```
Endpoints that accept service key calls read `household_id` from the form field (`process-receipt`) or query param (`/summary/last7days`, `/this-week`, `/insurance`).

### Internal Key Auth (bot ↔ backend internal endpoints)

Endpoints under `/internal/*` and `/setup/*` are in `SKIP_AUTH_PATHS` (no JWT needed). They validate the `X-Internal-Key` header against the `INTERNAL_KEY` env var instead.

---

## WhatsApp Bot (`backend/whatsapp/`)

### Key patterns

- **`groupMap`** — `Map<groupJid, {household_id, settings}>` — built on connect, refreshed every 5 min
- **`cronJobs`** — `Map<household_id, CronJob>` — one cron per household, rescheduled when settings change
- **`currentSock`** — module-level reference to the active Baileys socket, used by QR regeneration poller
- **`SERVICE_KEY`** — `SUPABASE_KEY` value used as bearer for all backend API calls
- **Daily renewal cron** — 09:00 SGT cron hits `/internal/insurance/renewals` and sends reminders to household groups
- **`lib/parsing.js`** — the pure helpers below live here rather than in `index.js`, so they can be
  unit-tested without a Baileys socket (`npm test`, no dependencies). Anything added here should be
  pure too; anything needing a socket or the backend stays in `index.js`.
- **`stripLeadingMentions(text)`** — strips a leading `@<phone>`/`@<name>` mention before any command match or
  `/internal/graph-invoke` call; without it, `@-mentioning` the bot broke every prefix-based match (custom
  commands, `/remind`, and `homly_graph.py`'s `classify_node` all check how the string *starts*)
- **`wasBotMentioned(msg, sock)` / `isReplyToBot(msg, sock)`** — the two addressing signals only the
  client can see (an `@mention` of its own JID, which `stripLeadingMentions` then removes from the
  text, and a reply to one of its own messages). Forwarded to `/internal/graph-invoke` so
  `services/bot_profile.should_engage()` can apply the household's engagement mode — see Assistant
  Engagement Flow. Detecting the bot's *name* is deliberately left to the backend, which knows
  each household's `bot_name`.
- **`handleHelpCommand(text, ...)`** — exact-match `/help` or "what can you do", fetches
  `/internal/help` (built from each registered agent's `manifest.examples`) rather than leaving
  "what can you do" to the LLM to notice and answer well on its own

### Env vars (`backend/whatsapp/.env`)

| Variable | Description |
|----------|-------------|
| `FASTAPI_URL` | Backend URL (e.g. `http://localhost:8000`) |
| `SUPABASE_KEY` | Supabase service role key (never expires — no refresh needed) |
| `INTERNAL_KEY` | Shared secret for `/internal/*` endpoints (default: `homly-internal`) |

---

## Local Development

### Backend

```bash
cd backend
pip install -r requirements-dev.txt   # pulls in requirements.txt + pytest + ruff
# Create backend/.env with SUPABASE_URL, SUPABASE_KEY, INTERNAL_KEY, OPENROUTER_API_KEY,
# and SUPABASE_DB_URL (direct connection string — needed for `alembic upgrade head`)
alembic upgrade head    # apply migrations — see backend/migrations/README.md
uvicorn api.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
# Create frontend/.env.local with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

### WhatsApp bot

```bash
cd backend/whatsapp
# Create backend/whatsapp/.env with FASTAPI_URL, SUPABASE_KEY, INTERNAL_KEY
npm run dev
```

### MCP server (query data from Claude Code / Claude Desktop)

```bash
cd backend/mcp_server
pip install -r requirements.txt
# Generate a key from the portal: Settings → MCP → Generate key
# Create backend/mcp_server/.env with FASTAPI_URL, HOMLY_MCP_KEY
python server.py
```

See `backend/mcp_server/README.md` for registering it with Claude Code (`claude mcp add`) or Claude Desktop.

---

## Testing & CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.
Run the same checks locally before pushing — all of them are fast:

```bash
cd backend && pip install -r requirements-dev.txt
ruff check .                        # config in backend/ruff.toml
python -m compileall .              # syntax check across the whole tree
pytest                              # config in backend/pytest.ini; testpaths = tests
python tests/check_household_scoping.py

cd ../frontend && npm install
npm run lint                        # eslint
npm run typecheck                   # tsc --noEmit — `next build` does NOT typecheck in Next 16
npm test                            # vitest
npm run build

cd ../backend/whatsapp              # no npm install needed — both are dependency-free
npm run check                       # node --check over every .js file
npm test                            # node --test over lib/
```

### What blocks a merge

| Check | Job | Blocking |
|-------|-----|----------|
| `ruff check .` | backend | yes |
| `python -m compileall .` | backend | yes |
| `pytest` | backend | yes |
| `tests/check_household_scoping.py` | backend | yes |
| `tsc --noEmit` | frontend | yes |
| `next build` | frontend | yes |
| `vitest run` | frontend | yes |
| `eslint` (whole tree) | frontend | **no — informational** (~104 pre-existing findings) |
| `eslint` (changed files only) | frontend | **not yet** — see the step comment; flipping it is one line |
| `npm run check` | whatsapp | yes |
| `npm test` | whatsapp | yes |

Every step runs with `continue-on-error` so its output can be captured for the sticky PR
summary comment; a final `Fail job if blocking checks failed` step is what actually fails
the job. **Adding a check means adding it to that condition too** — otherwise it reports
and nothing more.

A red check does not by itself prevent a merge: that requires a branch protection rule
or ruleset on `main` requiring these checks by name.

### Writing backend tests

Tests live in `backend/tests/`, are plain pytest functions (no classes), and follow a few
conventions that are load-bearing rather than stylistic:

- **The module docstring names the bug or invariant the file pins**, not the functions it
  calls. A test whose reason for existing isn't written down gets deleted by the next
  person who finds it inconvenient.
- **No test may make a network call.** `services/llm_client.py`'s functions are mocked as
  *module attributes*:
  ```python
  import services.llm_client as llm_client
  monkeypatch.setattr(llm_client, "get_completion", lambda *a, **k: '{"type": "text_query"}')
  ```
  This works because every call site does a **function-local** `from services.llm_client
  import get_completion`. A module-level import of that name in new code would silently
  break every existing test's mock — keep the local import.
- **Assert the LLM was *not* called** where a short-circuit is the point. `_fail` helpers
  that raise on invocation are used for this in `test_classify_text.py`.

### Faking the database

`tests/fakes.py` holds the one `FakeSupabase`. Don't hand-roll another — two fakes that
disagree about what Supabase does produce two tests that agree with each other and neither
with production. It applies filters to seeded rows and records every call, so a test can
assert on the filters applied and not just the rows returned.

`tests/conftest.py` provides:

| Fixture | Gives you |
|---------|-----------|
| `placeholder_env` | Dummy `SUPABASE_URL`/`SUPABASE_KEY`/`OPENROUTER_API_KEY`, enough to import anything |
| `fake_supabase` | A `FakeSupabase` installed as *the* client |
| `api_client` | `TestClient(app)` with the fake DB, lifespan skipped |

`fake_supabase` works by seeding `services.db._client` before anything builds a real
client — `get_supabase()` short-circuits on a populated `_client`, so this covers both
acquisition patterns at once (module-level `supabase = get_supabase()` in ~12 modules, and
the lazy `_db()` accessor in ~19). Modules already imported are re-pointed explicitly; see
`_MODULE_LEVEL_CLIENTS`.

`api_client` deliberately does **not** enter `TestClient` as a context manager. Doing so
runs `api/main.py`'s lifespan, which starts APScheduler and calls `refresh_summaries()`
against Supabase.

### Writing frontend tests

Vitest, `environment: "node"` — everything covered today is pure logic in `lib/` and
`config/`. Switch to `jsdom` and add `@testing-library/react` when the first component test
lands, not before.

`lib/dates.ts` and `lib/insurance.ts` hold logic that used to be duplicated, unexported,
inside page components. **They are a staging post, not a home.** "Frontend stays thin"
below says this maths belongs in the backend; these modules exist so the behaviour is
pinned by tests before each function moves server-side. Prefer adding a field to an API
response over adding a function there.

`config/apps.test.ts` checks every `nav[].href` against the routes actually on disk, so a
nav item pointing at a deleted page fails the suite rather than 404ing for a user.

### The multi-tenancy guard

RLS is disabled on every shared table (see "Multi-tenancy" below), so this invariant has
two mechanical guards and both matter:

- **Static** — `tests/check_household_scoping.py` walks the AST for `.table("x")` calls on
  household-scoped tables and reports any it cannot show to be scoped. It recognises four
  safe shapes: `household_id` in the statement; a chain built across statements
  (`q = q.eq(...)`); a write whose payload dict carries it (including list comprehensions
  and `rows.append(row)` accumulators); and a query narrowed by a key inside a function that
  already ran a scoped query (update-by-id after an ownership check, or a child table by
  foreign key). Anything else needs an explicit marker on the statement or in the comment
  block above it:

  ```python
  # household-scope: ok — <why this cannot reach another household>
  ```

  There are five markers in the tree today (super-admin price intelligence, the two
  cross-household `/internal/reminders/due` queries, and the two `whatsapp_message_id`
  dedup lookups, which must *not* be scoped because that column is UNIQUE table-wide).
  The check is **blocking**, and `tests/test_household_scoping_check.py` proves it still
  catches a real leak — a linter that only ever passes gets trusted and shouldn't be.
- **Runtime** — `tests/fakes.py`'s `assert_scoped_to(db, household_id)` fails if any
  recorded call on a shared table neither filtered on nor wrote that `household_id`. Use it
  in any test that drives a router.

`HOUSEHOLD_SCOPED_TABLES` is duplicated between those two files by design (one is imported
by the scanner run as a bare script, one by pytest); if you add a household-scoped table,
add it to both.

---

## Key Patterns & Conventions

### Frontend stays thin — business logic lives in the backend

The frontend's job is to call an endpoint and render what it returns. If you're writing frontend code that computes a domain-meaningful number or rule rather than just formatting/displaying one the backend already gave you, stop and move it to the backend instead.

**Signals that logic has leaked into the frontend and needs to move:**
- Date/period math beyond formatting — ISO week calculations, custom week boundaries (`summary_day`/`cutoff_mode`), "days until X", month-end/date-range derivation.
- Aggregation — summing, grouping, averaging, or computing totals/percentages/breakdowns over records fetched from the API, especially by combining data from **multiple** endpoints or requests client-side.
- A loop that fires multiple sequential/parallel API calls to compute one derived value. This is close to always a sign that a single backend endpoint or field should do that work and return the finished number instead.
- Business rules or thresholds — eligibility, "is this reimbursable/expiring/overdue", unit conversions (e.g. quarterly → monthly premium) — encoded in TS rather than read from the API response.
- The same calculation implemented more than once (two frontend files, or frontend duplicating backend) — a strong sign it should be centralized in one backend endpoint instead of kept in sync by hand across copies.

**Why it matters:** duplicated math drifts (a formula tweaked on one side but not the other silently shows a different number on refresh vs. after an optimistic UI update), and calendar/financial math is easy to get subtly wrong once (custom week boundaries not aligning with ISO weeks caused a real reimbursement-total bug — see git history on `frontend/app/(shell)/expenses/page.tsx` / `backend/api/routers/expenses.py`).

**What to do instead:** add a field to an existing response, or add a new endpoint, that returns the already-computed value; have the frontend just read and display it. When fixing a bug in a computed value shown in the UI, check whether the computation is happening client-side before patching it there — if it is, move it server-side as part of the fix rather than patching the frontend copy.

This codebase still has known offenders worth cleaning up opportunistically — prefer moving one of these to the backend over adding a new client-side computation next to it:

- **Receipt re-aggregation** in `expenses/page.tsx`'s `handleDelete`/`handleToggleReimbursable`. The worst one left: it re-implements `services/reimbursement.py`'s `compute_reimbursement_totals()` client-side after an optimistic update, and the two copies **have already drifted** — one rounds as `round(Math.max(0, x - totalPaid))`, the other as `Math.max(0, round(x - totalPaid))`. It lives inside `useState` updater closures, so extracting it is a real refactor; the right fix is to have the backend return the recomputed week.
- **Parallel net-worth calc** in `savings/page.tsx`.
- **Week maths and premium normalization** — no longer duplicated: `getCustomWeekStart`, `getWeekRange`, `daysUntil` and `monthlyPremium` now live once in `lib/dates.ts` / `lib/insurance.ts` with tests. Still client-side, still owed a move to the backend; the tests exist so that move is verifiable rather than a leap. (`expenses/reimburse/page.tsx` used to join `/weeks` + `/reimbursements` client-side to compute per-week outstanding — that's now backend-computed on `/weeks` itself via `services/reimbursement.py`'s `compute_reimbursement_totals()`.)

### Backend stays DRY — no copy-pasted business-logic helpers across routers

The same rule applies within the backend: if a helper needs to be called from more than one router, it belongs in `backend/services/` (or another shared module), imported by both — not reimplemented in each file. Copy-pasted logic drifts the same way duplicated frontend math does, except here it can mean the WhatsApp bot path and the web upload path silently disagree on a business rule.

`get_reimbursable()` (eligibility) and `compute_reimbursement_totals()`/`mark_receipts_reimbursed()` (totals and paid-state) already live in `services/reimbursement.py` for exactly this reason — every router that touches reimbursement (`expenses.py`, `messages.py`, `reimbursements.py`, `webhook.py`, `homly_graph.py`) calls into it rather than reimplementing the rule. Keep it that way: a future change to reimbursement rules is one edit away from applying inconsistently across the dashboard, WhatsApp bot, and weekly summary paths otherwise.

### One Supabase client — `services/db.py`'s `get_supabase()`

**Never call `create_client()` directly.** Every router, service and agent gets its
client from `services/db.py`:

```python
from services.db import get_supabase
supabase = get_supabase()          # cached; safe at import or inside a function
```

There used to be 40 of them, one per module, each with its own httpx connection pool.
That mattered because Supabase's edge hands back a GOAWAY after serving two streams on
a pooled HTTP/2 connection, and over HTTP/2 httpcore cannot tell: the GOAWAY sits unread
in the socket buffer, so the next call goes out on a dead connection and comes back as
`httpx.RemoteProtocolError` with no response at all. It reached users as a dashboard
500 — `GET /household` failing on its *third* Supabase query while the two before it
succeeded (28 of them in one seven-minute window, see
`documents/039-supabase-connection-retries/`).

`get_supabase()` does two things about that, and **both matter**:

1. **Takes the sessions off HTTP/2** (`_disable_http2`). httpcore's HTTP/1.1 pool checks
   whether an idle socket has gone readable before reusing it, so a server that hung up
   is spotted *before* a request is put on the connection. Its HTTP/2 pool only checks
   the keep-alive clock. This is the actual fix.
2. **Wraps each session's transport in a retry** (`_RetryTransport`) for whatever still
   slips through. Retrying alone was tried first and was not enough — see the document.

The retry is for connections that died with no answer, not for answers you don't like:
a 4xx/5xx from PostgREST is passed straight through to the caller. Writes are only
re-sent when the failure itself proves the server never processed them (see
`_server_never_processed_it`), so a retry can't duplicate an insert.

### Multi-tenancy: every query on a shared table must filter by `household_id`

Most tables (`receipts`, `items`, `households`, `reimbursements`, `pantry_items`, `price_history`, etc.) have `ROW LEVEL SECURITY` explicitly **disabled** (see the migration files) — household isolation is enforced entirely by application code remembering to scope every query. There is no database-level backstop.

Treat a Supabase call against a shared table that's missing `.eq("household_id", household_id)` (or the equivalent `Query`/`Form` param for service-key endpoints — see the pattern below) as a cross-household data leak, not a minor bug. When adding a new endpoint or table, check whether RLS is enabled for it; if it's disabled, the household filter in the query itself is the *only* thing preventing one household from reading or writing another's data.

### Auth middleware pattern — `is_service_key`

When the service key is used, `household_id` is not resolved in middleware. Endpoints that need it must:
```python
resolved = request.state.user.get("household_id")
if not resolved and request.state.user.get("is_service_key"):
    resolved = household_id  # from Form() or Query()
if not resolved:
    raise HTTPException(403, "No household found")
```

### Frontend: never read `NEXT_PUBLIC_API_URL` directly — import `API_URL`

`lib/apiUrl.ts` exports the backend base URL with trailing slashes stripped, and
`lib/axios.ts` uses it as the axios `baseURL`. Anything that builds a URL by hand (a raw
`fetch` on the auth pages, the receipt upload, the MCP setup snippets) imports `API_URL`
from `@/lib/apiUrl` rather than reading the env var.

The env var is configured with a trailing slash in at least one deploy, and every caller
concatenates a leading `/` onto it — which produced `GET //household`, a FastAPI 404, and
a returning member bounced to `/onboarding` because the 404 body has no `id`. It lives in
its own module rather than in `lib/axios.ts` so the landing page can import it without
pulling in the Supabase browser client.

### Dark theme

All shell pages use **dark stone theme** matching the landing page (`bg-[#0f0e0c]`):
- Cards: `bg-stone-900 border border-stone-800`
- Text: `text-stone-100` (primary), `text-stone-300/400` (secondary), `text-stone-500` (muted)
- Inputs: `bg-stone-800 border border-stone-700 text-stone-200 placeholder:text-stone-600`
- Active states: use app color directly (e.g. `bg-emerald-600`, `bg-blue-600`)
- Accent hover states (dark): `hover:bg-stone-800`, `hover:border-stone-600`

### Shell layout — key props

`ShellLayout` passes to each component:
- `Rail`: `activeApp`, `isSuperAdmin` — controls which app icons and admin icon are shown
- `Topbar`: `pageTitle`, `activeApp`, `user`, `onSignOut` — displays title and sign-out button
- `Subnav`: `activeApp`, `pathname`, `connected` — shows per-app nav + WhatsApp status

### Mobile responsiveness

- Shell uses `h-[100dvh]` to account for mobile browser chrome
- `BottomTabBar` uses `padding-bottom: env(safe-area-inset-bottom)` for iPhone notch
- Touch targets: minimum `min-h-[44px]` on all tappable elements
- Form inputs: `text-base` (16px) to prevent iOS zoom on focus
- Bottom sheets: `items-end sm:items-center` + `rounded-t-2xl sm:rounded-2xl`

### Receipt deduplication

`whatsapp_message_id` is unique on the `receipts` table. The `process-receipt` endpoint checks for an existing row before OCR, returning `{"status": "duplicate"}` if found.

### Soft deletes

Receipts use `deleted: boolean`; insurance policies use `is_active: boolean`. All queries filter these fields.

---

## Migrations

Schema changes run through **Alembic** (`backend/alembic/`), not by hand —
see `backend/migrations/README.md` for the full writeup, including why this
changed (numbering collisions — four files were prefixed `016_`, two `017_`,
two `029_` — and a real silent-failure bug that fell out of applying
migrations with no ledger of what had actually run).

```bash
cd backend
alembic upgrade head                     # apply any unapplied migrations
alembic revision -m "add foo to bar"     # start a new one
```

The original `backend/migrations/*.sql` files (`001` through `029`) are kept
unchanged as the source of truth; each has a thin Alembic revision under
`backend/alembic/versions/` that does nothing but `op.execute()` that file's
contents, chained by explicit parent pointer instead of filename number — so
a repeat of the `016`/`017`/`029` collisions is no longer possible.
`030_pantry_pending_confirmations.sql` is the first migration applied
through Alembic rather than pasted into the SQL editor by hand.

Requires `SUPABASE_DB_URL` — use the **Session pooler** connection string
from Supabase dashboard → Connect (the "Direct connection" hostname is
IPv6-only and unreachable from most networks; Transaction pooler drops the
session state Alembic's advisory locking needs — see
`backend/migrations/README.md`). Migrations are **roll-forward
only**: every revision's `downgrade()` raises `NotImplementedError` by
default — write a new migration to fix a mistake rather than reverting one,
since by the time a revert is needed, real data has usually moved underneath
the schema it would be reverting.

**A migration that removes or narrows anything — drops a column, tightens a
CHECK constraint, removes an enum value — must stay compatible with
whatever the currently-running code still writes or reads.** Code and
schema don't deploy atomically; during a rolling deploy, old and new code
run against the same database at once. `026_pantry_fridge_source.sql`
narrowed the `pantry_items.added_by` CHECK constraint and dropped `'bot'`
while `pantry_agent.py` was still writing `added_by = 'bot'` on every
WhatsApp pantry update — every one of those upserts then failed silently
until `029_pantry_bot_source.sql` restored it. Grep for what still writes or
reads a value before a migration stops allowing it.
