# Homly

## Project Overview

Homly is a household expense tracker powered by WhatsApp. Household members photograph receipts in a shared WhatsApp group; the bot OCR-analyses them, stores structured data, and delivers weekly expense summaries back to the group. A web dashboard lets admins manage settings, view expenses by week, and connect the WhatsApp bot.

The platform is **multi-tenant**: one backend and one WhatsApp bot instance serve multiple households simultaneously, each isolated by `household_id`.

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
│   │       └── insurance.py         # GET/POST/PUT/DELETE /insurance, GET /internal/insurance/renewals
│   ├── agents/
│   │   └── receipt_agent.py        # Vision LLM call → structured JSON receipt data
│   ├── services/
│   │   └── llm_client.py           # Facade: get_vision_completion()
│   ├── migrations/
│   │   ├── 001_homly.sql           # Base schema: receipts, items, weekly views
│   │   ├── 002_soft_delete.sql     # deleted flag on receipts
│   │   ├── 003_settings.sql        # settings table per household
│   │   ├── 004_sender.sql          # sender_name, sender_phone on receipts
│   │   ├── 006_multi_tenant.sql    # households, household_members, invites tables
│   │   ├── 007_group_jid.sql       # group_jid on settings, user_id nullable on receipts
│   │   ├── 013_reimbursement.sql   # reimbursable flag on receipts, reimbursements table, settings columns
│   │   ├── 014_image_storage.sql   # image_path on receipts, Supabase Storage
│   │   └── 015_insurance_policies.sql  # insurance_policies table with RLS
│   └── requirements.txt
├── frontend/
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
└── whatsapp/                       # Standalone Node.js WhatsApp bot
    ├── index.js                    # Main bot: QR connect, receipt processing, weekly summaries, insurance queries
    ├── package.json
    └── .env                        # FASTAPI_URL, SUPABASE_KEY, INTERNAL_KEY
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

Current apps:
- `expenses` — color `#10B981`, nav: Overview, Transactions, Members, Summary, Insights
- `insurance` — color `#3B82F6`, nav: Policies, Renewals
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

### Super-admin (JWT required, `is_super_admin = true`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/households` | List all households with member + receipt counts |
| PATCH | `/admin/households/{id}` | Update household (name, plan, active) |
| POST | `/admin/invite` | Send invite email |
| GET | `/admin/invites` | List all invites |
| DELETE | `/admin/invites/{id}` | Revoke invite |
| GET | `/admin/price-intelligence` | Cross-household price comparison + trends |

### Internal (service key or `X-Internal-Key` header — not JWT)

| Method | Path | Caller | Description |
|--------|------|--------|-------------|
| GET | `/internal/settings` | Bot | All households' settings array |
| POST | `/internal/qr` | Bot | Push QR data URL to backend state |
| POST | `/internal/connected` | Bot | Signal connected + push group list |
| GET | `/internal/qr-status` | Bot | Check/clear QR regeneration flag |
| GET | `/internal/messages` | Bot | Pop queued messages (clears queue) |
| GET | `/internal/insurance/renewals` | Bot | Policies renewing in 7 or 30 days |

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
- **Insurance query handling** — `isInsuranceQuery(text)` detects keywords; `handleInsuranceQuery()` formats a reply
- **Daily renewal cron** — 09:00 SGT cron hits `/internal/insurance/renewals` and sends reminders to household groups

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
# Create backend/.env with SUPABASE_URL, SUPABASE_KEY, INTERNAL_KEY, OPENROUTER_API_KEY
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

---

## Key Patterns & Conventions

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

Run migrations manually in Supabase SQL editor in order:

```
001_homly.sql          → base schema
002_soft_delete.sql    → deleted flag
003_settings.sql       → settings table
004_sender.sql         → sender fields on receipts
006_multi_tenant.sql   → households, members, invites + backfill
007_group_jid.sql      → group_jid on settings, user_id nullable on receipts
013_reimbursement.sql  → reimbursable flag on receipts, reimbursements table, settings columns
014_image_storage.sql  → image_path on receipts, Supabase Storage
015_insurance_policies.sql  → insurance_policies table + RLS + index
```

> There is no migration runner — apply each file manually. Files are idempotent (`IF NOT EXISTS`, `IF NOT NULL`).
