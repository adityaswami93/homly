# 001 — Receipt OCR — Release

## What was built
Full MVP: WhatsApp bot detects receipt images → OCR extracts vendor/items/total → saved to Supabase → dashboard shows weekly breakdown by category.

## Files changed
- `backend/agents/receipt_agent.py` — Gemini Flash OCR agent
- `backend/services/llm_client.py` — OpenRouter client
- `backend/api/routers/expenses.py` — all expense endpoints
- `backend/api/main.py` — FastAPI app
- `backend/migrations/001_homly.sql` — receipts, items tables, views
- `backend/whatsapp/index.js` — Baileys bot
- `frontend/app/dashboard/page.tsx` — this week dashboard
- `frontend/app/history/page.tsx` — history page
- `frontend/app/login/page.tsx` — login
- `frontend/app/components/Navbar.tsx` — navigation

## Database migrations
Run in Supabase SQL Editor:
- `backend/migrations/001_homly.sql`

## Environment variables
Backend:
- `SUPABASE_URL`
- `SUPABASE_KEY` (service role)
- `SUPABASE_JWT_SECRET`
- `OPENROUTER_API_KEY`
- `HOMLY_USER_ID`

WhatsApp bot:
- `GROUP_NAME`
- `FASTAPI_URL`
- `HOMLY_USER_ID`
- `HOMLY_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_REFRESH_TOKEN`

## Deployment
- Backend → Railway (root: `backend/`, start: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`)
- WhatsApp bot → Railway (root: `backend/whatsapp/`, start: `node index.js`)
- Frontend → Vercel (root: `frontend/`)

## Known issues
- `sender_name` and `sender_phone` not populating — debug in progress (issue 004)
- Receipt images not stored — only filename saved (planned: issue 006)
