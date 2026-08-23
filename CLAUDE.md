# Homly

## Project Overview

Homly is a household expense tracker powered by WhatsApp. Household members photograph receipts in a shared WhatsApp group; the bot OCR-analyses them, stores structured data, and delivers weekly expense summaries back to the group. A web dashboard lets admins manage settings, view expenses by week, and connect the WhatsApp bot.

The platform is **multi-tenant**: one backend and one WhatsApp bot instance serve multiple households simultaneously, each isolated by `household_id`.

---

## Keep This File in Sync

This file is the primary map new coding agents use to orient in the repo — an out-of-date entry is worse than no entry, because it's trusted by default. **When your change adds a new backend router, a new migration, or a new frontend app/page, update the matching section of this file (Project Structure, API Endpoints, Database Schema, Migrations, Apps Config) in the same change**, not as a follow-up.

This has already drifted once: `backend/api/routers/` has noticeably more router files than are mentioned in Project Structure/API Endpoints, and `backend/migrations/` has noticeably more files than are listed under Migrations. Don't treat updating this file as optional polish — a missing endpoint or table here means the next agent (or human) makes decisions on incomplete information. Run `ls backend/api/routers` / `ls backend/migrations` if you need the current exact counts; don't hard-code them here, since they'll just drift again.

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
│   │   │                           #   extensibility point — add an agent there and it's routable
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
│   │   ├── llm_client.py           # Facade: get_completion(), get_vision_completion()
│   │   ├── reimbursement.py        # get_reimbursable() — shared by /process-receipt and the WA webhook
│   │   ├── receipts.py             # compute_category_totals() — shared item-category aggregation
│   │   ├── price_history.py        # compute_price_insights() — shared price-trend/best-vendor math
│   │   ├── pantry_confirmations.py # pending "add these to your pantry?" prompts, keyed by group_jid
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
│   │   └── 033_bot_personality.sql   # bot_name/tone/engagement_mode/casual_chat/proactive on settings
│   ├── alembic.ini
│   ├── requirements.txt
│   └── whatsapp/                   # Standalone Node.js WhatsApp bot (Baileys)
│       ├── index.js                # Connects, forwards every message to /internal/graph-invoke
│       ├── package.json
│       └── .env                    # FASTAPI_URL, SUPABASE_KEY, INTERNAL_KEY
└── frontend/
│   ├── config/
│   │   └── apps.ts                 # Central app/nav config (single source of truth for shell nav)
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
│       ├── supabase.ts             # Supabase browser client
│       ├── axios.ts                # Shared axios instance with auth interceptor
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
classify_node (text messages only — an image is always an explicit action)
    ↓
addressed = was_mentioned OR is_reply_to_bot OR bot_profile.mentions_name(text, bot_name)
    ↑ the first two come from whatsapp/index.js, which knows its own JID; the
    ↑ backend adds the name check because bot_name is per-household
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
| `always` | every text message |

Receipts, recipes, fridge scans, `pantry_confirmation` and `payment_confirmation` bypass
the gate in every mode (`_ALWAYS_ENGAGE`) — a photo is a deliberate action, and swallowing
a pantry confirmation would strand the flow with a prompt nobody can close.

**Why `unknown` reroutes to the orchestrator instead of `END`:** the classifier is a fixed
prefix/suffix keyword match, so ordinary conversation ("morning!", "thanks!") never matched
and the group got silence from something that presents itself as an assistant. The
orchestrator cannot go silent — `force_finalize_node` strips its tools and forces a text
answer, and `run_query()` falls back to a fixed string — so handing it the message is what
makes "always responds" true. **Don't add a new silent path out of `classify_node`.**

### Proactive Household Monitor Flow

Every other agent in this codebase is reactive — it only runs because a household member
sent a WhatsApp message. `agents/proactive_agent.py` is the one exception: the same
Reason/Act/Observe (ReAct) loop shape as `agents/orchestrator/supervisor.py`, run
unprompted on a schedule instead of triggered by a message.

```
Daily 08:00 SGT cron (services/whatsapp_scheduler.py, in-process, no HTTP hop):
    _run_proactive_checks() loads every household with a connected group_jid
    ↓ per household, on a thread (LLM + Supabase calls are blocking):
    agents/proactive_agent.run_proactive_check(household_id, group_jid)
        ↓
      LangGraph loop: agent_node (LLM + tool-bound) ⇄ tools_node, up to 8 iterations
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
| POST | `/internal/graph-invoke` | Bot | Invoke `agents/homly_graph.py` for a WhatsApp message (text or image). Text calls also carry `sender_name`/`sender_phone` and the `was_mentioned`/`is_reply_to_bot` addressing flags |
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
pip install -r requirements.txt
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

This codebase currently has known offenders worth cleaning up opportunistically (custom-week math and receipt re-aggregation in `expenses/page.tsx`, the multi-endpoint join in `expenses/reimburse/page.tsx`, duplicated `getWeekRange`/`daysUntil` helpers across pages, client-side premium normalization in `insurance/page.tsx`, and the parallel net-worth calc in `savings/page.tsx`) — prefer moving one of these to the backend over adding a new client-side computation next to it.

### Backend stays DRY — no copy-pasted business-logic helpers across routers

The same rule applies within the backend: if a helper needs to be called from more than one router, it belongs in `backend/services/` (or another shared module), imported by both — not reimplemented in each file. Copy-pasted logic drifts the same way duplicated frontend math does, except here it can mean the WhatsApp bot path and the web upload path silently disagree on a business rule.

Known offender: `_get_reimbursable()` is duplicated verbatim in `api/routers/expenses.py` and `api/routers/webhook.py`. A future change to reimbursement rules (e.g. a new `reimbursement_mode`) is one edit away from applying to receipts uploaded via the dashboard but not ones submitted via WhatsApp, or vice versa. Extract it to a shared module next time either copy needs to change.

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
