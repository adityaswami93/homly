# Finclaro — AI Financial Research Assistant

A production-grade RAG-powered financial research assistant built with FastAPI, Next.js, and Supabase.

## Stack

- **Frontend** — Next.js 16, TypeScript, Tailwind CSS, deployed on Vercel
- **Backend** — Python FastAPI, deployed on Railway
- **Database** — PostgreSQL + pgvector via Supabase
- **Auth** — Supabase Auth
- **LLMs** — OpenRouter (completions) + OpenAI (embeddings)
- **Email** — Resend
- **News** — NewsAPI

## Architecture
```
User → Next.js Frontend → FastAPI Backend → Supabase (pgvector)
                                          → OpenRouter (LLM)
                                          → OpenAI (embeddings)
                                          → Resend (email)
                                          → NewsAPI (news)
```

## Setup

### 1. Clone the repo
```bash
git clone https://github.com/yourusername/finclaro.git
cd finclaro
```

### 2. Set up Supabase

1. Create a new project at supabase.com
2. Go to SQL Editor and run `backend/migrations/001_initial.sql`
3. Enable the pgvector extension: Extensions → search "vector" → enable
4. Copy your project URL and anon key

### 3. Set up backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Fill in your .env values
uvicorn api.main:app --reload
```

### 4. Set up frontend
```bash
cd frontend
npm install
cp .env.example .env.local
# Fill in your .env.local values
npm run dev
```

### 5. Seed initial data
```bash
# Fetch and embed initial news articles
curl -X POST http://localhost:8000/ingest
```

## Key Features

- **RAG Pipeline** — semantic search over financial news with recency reranking
- **Morning Digest** — personalised daily email based on user topic preferences
- **Watchlist Digest** — weekly email summarising news for tracked stocks and topics
- **Chat History** — all questions and answers saved per user
- **Waitlist** — invite-only access with waitlist signup

## Project Structure
```
finclaro/
├── backend/
│   ├── api/
│   │   └── main.py              # FastAPI app, routes, scheduler
│   ├── ingestion/
│   │   └── news_fetcher.py      # NewsAPI ingestion
│   ├── pipelines/
│   │   ├── embedding_pipeline.py # OpenAI embeddings
│   │   └── rag_pipeline.py       # Retrieval and generation
│   ├── agents/
│   │   ├── digest_agent.py       # Morning digest
│   │   └── watchlist_digest_agent.py # Weekly watchlist digest
│   ├── services/
│   │   └── llm_client.py         # LLM facade (OpenRouter + OpenAI)
│   ├── migrations/
│   │   └── 001_initial.sql       # Database schema
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── page.tsx              # Landing page
│   │   ├── login/page.tsx        # Login + waitlist
│   │   ├── dashboard/page.tsx    # Chat interface
│   │   ├── watchlist/page.tsx    # Watchlist management
│   │   └── settings/page.tsx     # Digest preferences
│   ├── lib/
│   │   └── supabase.ts           # Supabase client
│   ├── Dockerfile
│   └── .env.example
└── README.md
```

## Deployment

### Backend — Railway

1. Connect GitHub repo to Railway
2. Set root directory to `backend`
3. Add environment variables from `.env.example`
4. Railway auto-deploys on push

### Frontend — Vercel

1. Connect GitHub repo to Vercel
2. Set root directory to `frontend`
3. Add environment variables from `.env.example`
4. Vercel auto-deploys on push

## Extending This Template

This repo is designed as a reusable RAG template. To adapt for a new domain:

1. Update `ingestion/news_fetcher.py` — change data sources and queries
2. Update `pipelines/rag_pipeline.py` — adjust the prompt for your domain
3. Update `agents/digest_agent.py` — customise digest format and topics
4. Update frontend pages — change copy and UI for your use case

The core RAG pipeline, auth, scheduling, and email infrastructure stays the same.