# Finclaro

## Project Overview

Finclaro is an AI-powered financial research assistant built for retail investors in Singapore. It ingests financial news from global sources, embeds them for semantic search, and provides three core experiences:

1. **Research chat** — ask questions about markets in plain English and get grounded, sourced answers via RAG
2. **Morning digest** — personalised daily email briefings based on user-selected topics
3. **Watchlist digest** — weekly email summaries for tracked stocks, crypto, and topics
4. **Earnings analyser** — upload earnings call transcript PDFs and get structured PM-grade analysis

The product is in **beta** with a waitlist-based signup flow. Authentication is handled by Supabase Auth. There is no billing yet (Stripe planned).

---

## Stack

| Layer | Technology | Why | Where it runs |
|-------|-----------|-----|---------------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 | App Router, server components, fast iteration | Vercel |
| Backend | FastAPI, Python 3.11, uvicorn | Async-ready, simple, fast for API + background jobs | Railway |
| Database | Supabase (PostgreSQL + pgvector) | Managed Postgres with vector search + built-in auth | Supabase Cloud |
| Auth | Supabase Auth | JWT-based, managed user table, easy frontend SDK | Supabase Cloud |
| LLM (completions) | OpenRouter (currently `openai/gpt-4o-mini`) | Model-agnostic routing, easy to swap models | OpenRouter API |
| LLM (embeddings) | OpenRouter (currently `openai/text-embedding-ada-002`) | 1536-dim vectors matching pgvector column | OpenRouter API |
| Email | Resend | Simple transactional email API | Resend API |
| News | NewsAPI | Financial news ingestion across 10 topic queries | NewsAPI |
| Rate limiting | slowapi | Per-IP rate limiting on FastAPI endpoints | Backend |
| Scheduling | APScheduler | Cron-like jobs for ingestion and digest delivery | Backend (in-process) |
| PDF parsing | PyPDF2 | Extract text from earnings call PDFs | Backend |

---

## Project Structure

```
finclaro/
├── CLAUDE.md                          # This file — project context for Claude Code
├── backend/
│   ├── api/
│   │   ├── main.py                    # FastAPI app setup, middleware, lifespan/scheduler, router registration
│   │   ├── models.py                  # Shared Pydantic models (Question)
│   │   ├── dependencies/
│   │   │   ├── limiter.py             # Shared slowapi Limiter instance
│   │   │   └── permissions.py         # require_admin, require_auth dependencies
│   │   ├── middleware/
│   │   │   └── auth.py                # JWT auth middleware (Supabase JWKS verification)
│   │   └── routers/
│   │       ├── chat.py                # POST /ask (RAG Q&A), GET /history
│   │       ├── watchlist.py           # GET/POST /watchlist, DELETE /watchlist/{item_id}
│   │       ├── preferences.py         # GET/POST /preferences
│   │       ├── earnings.py            # POST /analyse-earnings
│   │       └── admin.py               # POST /ingest, /digest, /watchlist-digest, /eval (require_admin)
│   ├── agents/
│   │   ├── digest_agent.py            # Daily morning digest: fetch articles → LLM summary → Resend email
│   │   ├── watchlist_digest_agent.py  # Weekly watchlist digest: vector search per symbol → LLM → email
│   │   └── earnings_agent.py          # Earnings analysis: PDF text extraction → structured LLM analysis
│   ├── pipelines/
│   │   ├── rag_pipeline.py            # RAG: embed query → pgvector search → recency rerank → LLM answer
│   │   └── embedding_pipeline.py      # Batch embed articles that have null embeddings
│   ├── ingestion/
│   │   └── news_fetcher.py            # Fetch news from NewsAPI for 10 finance queries → upsert to articles
│   ├── services/
│   │   └── llm_client.py              # Facade over OpenRouter: get_completion() and get_embedding()
│   ├── db/
│   │   └── client.py                  # (empty) Supabase client placeholder
│   ├── evals/
│   │   ├── __init__.py
│   │   ├── golden_dataset.json        # 10 curated test questions with expected topics and difficulty
│   │   ├── eval_metrics.py            # LLM-as-judge scoring: relevance, groundedness, source quality, confidence accuracy
│   │   ├── eval_runner.py             # Orchestrator: run golden dataset through RAG agent, score, save results
│   │   └── results/                   # Local JSON output from eval runs (gitignored)
│   ├── migrations/
│   │   ├── 001_initial.sql            # Full schema: articles, chat_history, watchlist, user_preferences, waitlist, earnings_analyses
│   │   └── 003_eval_runs.sql          # eval_runs table for tracking eval results over time
│   └── requirements.txt               # Python dependencies (pinned)
├── frontend/
│   ├── app/
│   │   ├── page.tsx                   # Landing page (public) — hero, features, CTA
│   │   ├── login/page.tsx             # Login + waitlist signup
│   │   ├── dashboard/page.tsx         # Research chat — ask questions, view answers + sources, history sidebar
│   │   ├── earnings/page.tsx          # Earnings analyser — PDF upload, structured analysis cards
│   │   ├── watchlist/page.tsx         # Watchlist management — add/remove stocks, crypto, topics
│   │   ├── settings/page.tsx          # Digest preferences — toggle, frequency, time, topics
│   │   ├── admin/page.tsx             # Admin dashboard — evals, waitlist, system actions, logs (admin only)
│   │   └── components/
│   │       └── Navbar.tsx             # Shared nav bar with active link highlighting + sign out
│   ├── lib/
│   │   ├── supabase.ts               # Supabase client init (browser-side, uses NEXT_PUBLIC_ env vars)
│   │   └── axios.ts                  # Axios instance with auth interceptor + 401 redirect
│   ├── package.json                   # Next.js 16, React 19, Supabase JS, axios, Tailwind 4
│   └── README.md                      # Default Next.js readme
```

---

## Architecture

### News Ingestion → Embedding → Storage

```
NewsAPI (10 queries) → news_fetcher.py → upsert articles table (dedup by URL)
                                              ↓
                        embedding_pipeline.py → get_embedding() → update articles.embedding
```

- Runs on cron every 6 hours (0, 6, 12, 18 UTC) via APScheduler in `main.py` lifespan
- Each query fetches 10 articles → up to 100 articles per ingestion cycle
- Articles without embeddings are batch-embedded using `text-embedding-ada-002` (1536 dims)
- Text is truncated to 6000 chars before embedding to stay within token limits

### RAG Pipeline (Research Chat)

```
User question → get_embedding(question)
                     ↓
               match_articles() RPC (pgvector cosine similarity, top 10)
                     ↓
               rerank_by_recency() — combined score: 70% similarity + 30% recency
                     ↓
               Take top 5 → build context
                     ↓
               get_completion() with financial analyst system prompt
                     ↓
               Parse USED_SOURCES from LLM response → return answer + cited sources
```

### Digest Pipeline (Daily Morning Email)

```
APScheduler (every hour on the hour) → check current SGT hour
    ↓
get_users_for_digest() → filter users whose digest_time matches current hour
    ↓
For each user: get topics → fetch recent articles by title match → LLM summary → Resend email
```

### Watchlist Digest Pipeline (Weekly Email)

```
APScheduler (Sunday 00:00 UTC) → get_all_users_with_watchlists()
    ↓
For each user: get watchlist symbols → vector search per symbol (top 3 each)
    ↓
Deduplicate articles → LLM summary → Resend email
```

### Earnings Pipeline

```
User uploads PDF → extract_text_from_pdf() (PyPDF2)
    ↓
Truncate to 12000 chars → get_completion() with structured JSON prompt
    ↓
Parse JSON response → save to earnings_analyses table → return to frontend
```

---

## Database Schema

All tables live in Supabase (PostgreSQL). RLS is **disabled** on all tables (dev mode).

### `articles`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | gen_random_uuid() |
| title | TEXT | NOT NULL |
| description | TEXT | |
| content | TEXT | Full article content from NewsAPI |
| url | TEXT | UNIQUE, NOT NULL — used for upsert dedup |
| source | TEXT | Publisher name |
| published_at | TIMESTAMPTZ | |
| embedding | vector(1536) | pgvector, NULL until embedded |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

### `chat_history`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| user_id | UUID (FK → auth.users) | ON DELETE CASCADE |
| question | TEXT | |
| answer | TEXT | |
| sources | JSONB | Array of {title, url, source} |
| created_at | TIMESTAMPTZ | |

### `watchlist`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| user_id | UUID (FK → auth.users) | ON DELETE CASCADE |
| symbol | TEXT | e.g. "AAPL", "BTC", "inflation" |
| type | TEXT | CHECK: stock, sgx, crypto, topic |
| label | TEXT | Display label |
| created_at | TIMESTAMPTZ | |
| | | UNIQUE(user_id, symbol) |

### `user_preferences`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| user_id | UUID (FK → auth.users) | UNIQUE, ON DELETE CASCADE |
| digest_enabled | BOOLEAN | DEFAULT true |
| digest_time | TEXT | DEFAULT '07:00' (SGT) |
| digest_frequency | TEXT | DEFAULT 'daily' |
| topics | TEXT[] | DEFAULT ['global markets', 'Singapore economy', 'Federal Reserve', 'inflation'] |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### `waitlist`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| email | TEXT | UNIQUE, NOT NULL |
| created_at | TIMESTAMPTZ | |

### `earnings_analyses`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| user_id | UUID (FK → auth.users) | ON DELETE CASCADE |
| ticker | TEXT | e.g. "AAPL" |
| analysis | JSONB | Structured earnings analysis object |
| transcript_length | INT | Character count of extracted text |
| created_at | TIMESTAMPTZ | |

### `eval_runs`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | gen_random_uuid() |
| run_id | TEXT | NOT NULL — groups results from a single eval run |
| question_id | TEXT | e.g. "q1" — matches golden dataset |
| question | TEXT | The question asked |
| difficulty | TEXT | easy, medium, hard |
| answer | TEXT | RAG agent's response |
| sources | JSONB | Array of cited sources |
| confidence | TEXT | Agent's self-assessed confidence |
| iterations | INT | Number of agentic loop iterations |
| relevance_score | INT | 1-5 |
| groundedness_score | INT | 1-5 |
| source_quality_score | INT | 1-5 |
| confidence_accuracy_score | INT | 1-5 |
| overall_score | INT | 1-5 |
| notes | TEXT | LLM judge's explanation |
| model | TEXT | e.g. "openai/gpt-4o-mini" |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

### Database Functions

- **`match_articles(query_embedding, match_count)`** — pgvector cosine similarity search, returns articles with similarity score
- **`get_user_emails()`** — SECURITY DEFINER function to read from `auth.users` (needed because agents can't directly query auth schema)

---

## API Endpoints

All endpoints are defined in `backend/api/main.py`.

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| GET | `/` | None | None | Health check |
| POST | `/ask` | JWT | 10/min | RAG question answering. Body: `{question, user_id?}` |
| POST | `/ingest` | JWT | 5/min | Trigger news fetch + embedding pipeline |
| POST | `/digest` | JWT | None | Trigger digest check for current hour |
| GET | `/history/{user_id}` | JWT | None | Get chat history (user can only access own) |
| GET | `/watchlist/{user_id}` | JWT | None | Get user's watchlist items |
| POST | `/watchlist` | JWT | 30/min | Add item to watchlist. Body: `{user_id, symbol, type, label}` |
| DELETE | `/watchlist/{item_id}` | JWT | None | Remove watchlist item |
| POST | `/watchlist-digest` | JWT | None | Trigger watchlist digest for all users |
| GET | `/preferences/{user_id}` | JWT | None | Get digest preferences (returns defaults if none saved) |
| POST | `/preferences` | JWT | None | Save/update digest preferences |
| POST | `/analyse-earnings` | JWT | 5/min | Upload PDF, get structured earnings analysis. Multipart form: `file`, `ticker`, `user_id` |
| POST | `/eval` | Admin | None | Run eval framework against golden dataset. Body: `{label?}` — returns run_id + summary |
| GET | `/admin/waitlist` | Admin | None | List all waitlist entries, newest first |
| DELETE | `/admin/waitlist/{entry_id}` | Admin | None | Remove a waitlist entry |
| GET | `/admin/evals` | Admin | None | List eval runs with averaged scores, grouped by run_id |
| GET | `/admin/evals/{run_id}` | Admin | None | Per-question breakdown for a specific eval run |
| GET | `/admin/logs` | Admin | None | Last 50 chat history entries across all users |

---

## Authentication

### Flow

1. Frontend uses `@supabase/supabase-js` to sign in (email/password) → gets JWT access token
2. Every API call includes `Authorization: Bearer <token>` header
3. Backend `verify_token()` dependency decodes JWT using `SUPABASE_JWT_SECRET` with HS256 algorithm and `authenticated` audience
4. Returns decoded payload (contains `sub` = user_id, `email`, etc.)

### Admin Check

- `require_admin()` compares `user.email` against `ADMIN_EMAIL` (set via `DIGEST_EMAIL` env var)
- Applied to all admin router endpoints via `router = APIRouter(dependencies=[Depends(require_admin)])`
- Frontend checks `user.email === NEXT_PUBLIC_ADMIN_EMAIL` for showing Admin nav link and protecting `/admin` page

### User Tier

- No tier system yet — all authenticated users have equal access
- Waitlist controls who can create accounts (insert into `waitlist` table, admin manually creates accounts)

---

## Key Patterns & Conventions

### LLM Facade (`services/llm_client.py`)
- Single file wraps all LLM calls behind `get_completion(prompt, system?)` and `get_embedding(text)`
- Uses OpenAI SDK pointed at OpenRouter's base URL — swap models by changing `_COMPLETION_MODEL` and `_EMBEDDING_MODEL` constants
- Every agent and pipeline imports from this facade — never calls OpenAI/OpenRouter directly

### Scheduled Jobs (APScheduler in lifespan)
- `run_ingestion` — every 6 hours (0, 6, 12, 18 UTC)
- `run_digest_for_current_hour` — every hour on the minute, checks which users want digest at current SGT hour
- `run_watchlist_digest` — weekly on Sunday at 00:00 UTC
- All jobs run in-process via `BackgroundScheduler` (not async)

### Recency Reranking
- RAG pipeline retrieves top 10 by vector similarity, then reranks with `combined_score = 0.7 * similarity + 0.3 * recency_score`
- Recency score: 1.0 for articles < 24h old, linearly decaying to 0 at 1 week

### Rate Limiting (slowapi)
- **Important**: `Request` must be the **first parameter** of any rate-limited endpoint function (before body models)
- Uses `get_remote_address` for per-IP limiting
- Limits: `/ask` = 10/min, `/ingest` = 5/min, `/watchlist` POST = 30/min, `/analyse-earnings` = 5/min

### Frontend Conventions
- All pages are `"use client"` (client components)
- Supabase client initialized in `lib/supabase.ts` using `NEXT_PUBLIC_` env vars
- API calls use the shared `api` instance from `lib/axios.ts` — **never use raw `axios`** for backend calls
- Dark theme: bg `#080808` or `#0a0a0a`, accent `emerald-400/500`
- All authenticated pages check session on mount, redirect to `/login` if not authenticated
- Navbar is a shared component accepting `user` prop and optional `children` slot

### Axios Interceptor (`lib/axios.ts`)
- Shared axios instance with `baseURL` set to `NEXT_PUBLIC_API_URL`
- **Request interceptor** automatically attaches `Authorization: Bearer <token>` from Supabase session — no manual token handling needed in pages
- **Response interceptor** catches 401 errors, signs out the user, and redirects to `/login`
- All frontend pages import `api` from `@/lib/axios` instead of raw `axios`

### Global Exception Handler (`main.py`)
- Catches all unhandled exceptions and returns a generic `{"detail": "An internal error occurred"}` with 500 status
- Logs the error with method, path, and exception details via Python `logging`
- Prevents leaking stack traces or internal details to clients

### Source Tracking in RAG
- LLM is prompted to append `USED_SOURCES: 1,3,5` to its response
- Backend parses this to only return actually-cited sources, not all retrieved articles

---

## Environment Variables

### Backend (`backend/`)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (e.g. `https://xxx.supabase.co`) |
| `SUPABASE_KEY` | Supabase **service role** key (not anon key — full access, bypasses RLS). Find in Supabase → Settings → API → Service role key |
| `SUPABASE_JWT_SECRET` | JWT secret for verifying Supabase auth tokens |
| `OPENROUTER_API_KEY` | API key for OpenRouter (completions + embeddings) |
| `NEWSAPI_KEY` | API key for NewsAPI news fetching |
| `RESEND_API_KEY` | API key for Resend email delivery |
| `DIGEST_EMAIL` | Admin email address (used for `verify_admin` check) |

### Frontend (`frontend/`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (baked into client bundle at build time) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public, safe for client-side) |
| `NEXT_PUBLIC_API_URL` | Backend API base URL (e.g. `https://finclaro-api.up.railway.app`) |
| `NEXT_PUBLIC_ADMIN_EMAIL` | Admin email address — controls visibility of Admin nav link and access to `/admin` page |

**Important**: `NEXT_PUBLIC_` prefixed variables are baked at **build time** on Vercel, not runtime. Changing them requires a redeploy.

---

## Local Development

### Backend

```bash
cd backend
pip install -r requirements.txt
# Create .env with all backend env vars listed above
uvicorn api.main:app --reload --port 8000
```

The backend runs at `http://localhost:8000`. The `--reload` flag enables auto-reload on file changes.

### Frontend

```bash
cd frontend
npm install
# Create .env.local with all frontend env vars listed above
npm run dev
```

The frontend runs at `http://localhost:3000`.

### Running Pipelines Manually

```bash
cd backend
python -m ingestion.news_fetcher        # Fetch news
python -m pipelines.embedding_pipeline  # Embed articles
python -m pipelines.rag_pipeline        # Test RAG query
python -m agents.digest_agent           # Run digest
python -m agents.watchlist_digest_agent # Run watchlist digest
python -m evals.eval_runner baseline    # Run model eval (optional label arg)
```

---

## Deployment

### Backend → Railway

- Deployed as a Docker/Python service on Railway
- Start command: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
- Environment variables set in Railway dashboard
- APScheduler runs in-process (no separate worker)

### Frontend → Vercel

- Deployed via Vercel's Next.js integration
- Environment variables set in Vercel dashboard (Project Settings → Environment Variables)
- `NEXT_PUBLIC_` vars baked at build time — changes require redeploy
- Auto-deploys on push to main branch

---

## Model Evaluation Framework

The `backend/evals/` directory contains a framework for systematically evaluating the agentic RAG pipeline's answer quality.

### How It Works

1. **Golden dataset** (`golden_dataset.json`) — 10 curated questions across easy/medium/hard difficulty, each with expected topics
2. **Eval runner** (`eval_runner.py`) — iterates through the dataset, runs each question through `ask_agent()`, scores each response, saves results
3. **LLM-as-judge** (`eval_metrics.py`) — uses the LLM to score responses across 4 dimensions

### Scoring Dimensions (1-5 scale)

| Metric | What it measures |
|--------|-----------------|
| **Relevance** | Does the answer directly address the question? |
| **Groundedness** | Are claims supported by cited sources? |
| **Source quality** | Did retrieval surface articles relevant to expected topics? |
| **Confidence accuracy** | Does the agent's stated confidence match actual quality? |

### Running Evals

```bash
cd backend
python -m evals.eval_runner                # Auto-generated run ID
python -m evals.eval_runner baseline       # Custom label
python -m evals.eval_runner post-prompt-v2 # Label after a change
```

Results are saved in two places:
- **Local JSON**: `backend/evals/results/<run_id>.json`
- **Supabase**: `eval_runs` table — filter by `run_id` to compare runs

### Comparing Runs

Query Supabase to compare average scores across runs:
```sql
SELECT run_id, AVG(overall_score) as avg_score, COUNT(*) as questions
FROM eval_runs GROUP BY run_id ORDER BY MIN(created_at) DESC;
```

### Extending the Golden Dataset

Add new questions to `golden_dataset.json` following the schema:
```json
{
  "id": "q11",
  "question": "Your question here",
  "difficulty": "easy|medium|hard",
  "expected_topics": ["topic1", "topic2"],
  "notes": "Why this question is useful for eval"
}
```

---

## Current Limitations & Known Issues

1. **NewsAPI free tier** — limited to 100 requests/day; fetching 10 queries per cycle × 4 cycles/day = 40 requests, but still constrained on article age (free tier returns articles up to 1 month old only)
2. **Resend onboarding domain** — emails sent from `onboarding@resend.dev` (not a custom domain), which limits deliverability and may land in spam
3. **RLS disabled** — all tables have Row Level Security disabled for development; anyone with the service key has full access
4. **No Stripe billing** — all users have equal access, no monetisation layer
5. ~~**No admin waitlist page**~~ — admin dashboard at `/admin` with waitlist management, eval runs, system actions, and query logs
6. **Digest time is SGT-hardcoded** — `(utcnow + 8) % 24` — no user timezone support
7. **No error boundaries** — frontend has basic try/catch but no React error boundaries
8. **Earnings history not displayed** — analyses are saved to DB but there's no UI to view past analyses

---

## Planned Features

- **Stripe monetisation** — paid tiers with usage limits
- ~~**Admin waitlist management page** — approve/reject waitlist signups from a dashboard~~ (done — see `/admin` page)
- **Earnings history per ticker** — view past analyses for a given stock
- ~~**Model evaluation framework** — compare LLM outputs across models for quality~~ (done — see `backend/evals/`)
- **Enable RLS for production** — row-level security policies on all tables
- **Custom email domain** — move off Resend onboarding domain
- **User timezone support** — allow digest time in user's local timezone
