# Homly

## Project Overview

Homly is a household expense tracker powered by WhatsApp. Household members photograph receipts in a shared WhatsApp group; the bot OCR-analyses them, stores structured data, and delivers weekly expense summaries back to the group. A web dashboard lets admins manage settings, view expenses by week, and connect the WhatsApp bot.

The platform is **multi-tenant**: one backend and one WhatsApp bot instance serve multiple households simultaneously, each isolated by `household_id`.

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
│   │       └── setup.py             # GET /setup/state, POST /setup/group, /setup/reset-qr, SSE /setup/qr-stream
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
│   │   └── 007_group_jid.sql       # group_jid on settings, user_id nullable on receipts
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── page.tsx                # Landing page
│   │   ├── login/page.tsx          # Login
│   │   ├── onboarding/page.tsx     # Household creation / invite acceptance
│   │   ├── dashboard/page.tsx      # Expense dashboard — weekly view, receipts list
│   │   ├── history/page.tsx        # Past weeks navigator
│   │   ├── settings/page.tsx       # Household settings — summary schedule, group selection
│   │   ├── setup/page.tsx          # WhatsApp bot setup — QR scan, group picker
│   │   ├── admin/page.tsx          # Super-admin panel
│   │   └── components/
│   │       ├── Navbar.tsx
│   │       └── Toast.tsx
│   └── lib/
│       ├── supabase.ts             # Supabase browser client
│       ├── axios.ts                # Shared axios instance with auth interceptor
│       └── toast.ts                # useToast hook
└── whatsapp/                       # Standalone Node.js WhatsApp bot
    ├── index.js                    # Main bot: QR connect, receipt processing, weekly summaries
    ├── package.json
    └── .env                        # FASTAPI_URL, SUPABASE_KEY, INTERNAL_KEY
```

---

## Architecture

### Multi-Tenancy Model

All data is scoped by `household_id`. A household has:
- One or more **members** (via `household_members` table, roles: `admin` / `member`)
- One **settings** row (summary schedule, WhatsApp group JID)
- Many **receipts** and **items**

The WhatsApp bot authenticates with the **Supabase service role key** (never expires) instead of per-user JWTs. The bot identifies which household to write to by looking up the incoming group's JID in the `settings.group_jid` column.

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

### WhatsApp Bot → Household Mapping

```
On connect:
  GET /internal/settings  →  array of all households' settings
  Build groupMap: groupJid → { household_id, settings }
  Schedule one cron per household (different days/times/timezones)

Every 5 min:
  Re-fetch settings → rebuild map if changed (e.g. new group assigned)

On receipt image in group X:
  groupMap.get(X.remoteJid) → household_id
  POST /process-receipt with household_id in form
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
| image_filename | TEXT | |

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

---

## API Endpoints

### User-facing (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/household` | Get own household + members |
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

### Internal (service key or `X-Internal-Key` header — not JWT)

| Method | Path | Caller | Description |
|--------|------|--------|-------------|
| GET | `/internal/settings` | Bot | All households' settings array |
| POST | `/internal/qr` | Bot | Push QR data URL to backend state |
| POST | `/internal/connected` | Bot | Signal connected + push group list |
| GET | `/internal/qr-status` | Bot | Check/clear QR regeneration flag |
| GET | `/internal/messages` | Bot | Pop queued messages (clears queue) |

### Setup (no auth — unauthenticated setup flow)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/setup/state` | Current WhatsApp connection state |
| POST | `/setup/reset-qr` | Request QR regeneration |
| POST | `/setup/group` | Set group name (legacy, prefer PATCH /settings) |
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
Endpoints that accept service key calls read `household_id` from the form field (`process-receipt`) or query param (`/summary/last7days`, `/this-week`).

### Internal Key Auth (bot ↔ backend internal endpoints)

Endpoints under `/internal/*` and `/setup/*` are in `SKIP_AUTH_PATHS` (no JWT needed). They validate the `X-Internal-Key` header against the `INTERNAL_KEY` env var instead.

---

## WhatsApp Bot (`backend/whatsapp/`)

### Key patterns

- **`groupMap`** — `Map<groupJid, {household_id, settings}>` — built on connect, refreshed every 5 min
- **`cronJobs`** — `Map<household_id, CronJob>` — one cron per household, rescheduled when settings change
- **`currentSock`** — module-level reference to the active Baileys socket, used by QR regeneration poller
- **`SERVICE_KEY`** — `SUPABASE_KEY` value used as bearer for all backend API calls

### Env vars (`backend/whatsapp/.env`)

| Variable | Description |
|----------|-------------|
| `FASTAPI_URL` | Backend URL (e.g. `http://localhost:8000`) |
| `SUPABASE_KEY` | Supabase service role key (never expires — no refresh needed) |
| `INTERNAL_KEY` | Shared secret for `/internal/*` endpoints (default: `homly-internal`) |

### Local development

```bash
cd backend/whatsapp
npm run dev          # node --watch index.js (auto-restart)
# or
npm start            # node index.js
```

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

On first run (no `auth_state/`), the bot generates a QR and pushes it to the backend. Open `http://localhost:3000/setup` and scan it. Once connected, go to **Settings** and select your WhatsApp group — this saves `group_jid` to the `settings` table, and the bot picks it up within 5 minutes.

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

### Setting `group_jid`

Household admins save their WhatsApp group JID via `PATCH /settings` with `{group_jid: "120363...@g.us", group_name: "..."}`. The bot's 5-minute settings poll picks it up automatically. The group list is available in `/setup/state` after the bot connects.

### QR regeneration

`POST /setup/reset-qr` sets `whatsapp_state["qr_requested"] = True`. The bot's 5-second poller calls `GET /internal/qr-status`, sees the flag, calls `currentSock.end()`, triggering Baileys to reconnect and generate a new QR. The frontend polls `/setup/state` every 3 seconds to display it.

### Receipt deduplication

`whatsapp_message_id` is unique on the `receipts` table. The `process-receipt` endpoint checks for an existing row before OCR, returning `{"status": "duplicate"}` if found. This prevents double-processing if the bot retries.

### Soft deletes

Receipts use `deleted: boolean` (not hard delete). All queries filter `.eq("deleted", False)`.

### Frontend conventions

- All pages are `"use client"` — no server components in use
- API calls always go through `lib/axios.ts` (`api` import), never raw axios
- Dark stone theme: `bg-[#0f0e0c]`, amber accent (`amber-400`), stone neutrals
- Toast notifications via `useToast` hook + `<ToastContainer />`

### Mobile responsiveness

**Navigation** — desktop nav links are `hidden sm:flex` in the header. A fixed bottom nav (`sm:hidden`) in `Navbar.tsx` handles mobile. All pages must add `pb-24 sm:pb-8` (or similar) to their content container to prevent content going under the bottom nav.

**Bottom padding pattern** — every page's `max-w-* mx-auto px-4 py-*` div must include `pb-24 sm:pb-*` so content scrolls clear of the fixed bottom nav on mobile.

**Grids** — never hardcode `grid-cols-N` without responsive variants. Use `grid-cols-N sm:grid-cols-M` so small screens stack or use fewer columns. Examples:
- 7-item row (days of week): `grid-cols-4 sm:grid-cols-7`
- 2-column category grid: `grid-cols-1 sm:grid-cols-2`
- 3 summary cards: `grid-cols-3` with `p-3 sm:p-4` and `text-sm sm:text-lg` inside

**Flex rows on mobile** — form rows that contain multiple inputs/selects/buttons use `flex-col sm:flex-row`. Inputs get `w-full sm:flex-1`, selects/buttons get `w-full sm:w-auto`.

**Drawers / sheets** — right-side drawer pattern on desktop becomes a bottom sheet on mobile:
```tsx
// Overlay
<div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end">
// Panel
<div className="w-full sm:max-w-md h-[88vh] sm:h-full rounded-t-2xl sm:rounded-none border-t sm:border-t-0 sm:border-l">
```

**Hiding non-essential info on mobile** — use `hidden sm:inline` for secondary labels (e.g. confidence badge in receipt rows, long button text). Show icon or abbreviated version on mobile instead.

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
```

> There is no migration runner — apply each file manually. Files are idempotent (`IF NOT EXISTS`, `IF NOT NULL`).
