# Homly

## Development process

Features are tracked and documented under `documents/`. Each feature has:
- `implementation.md` — the Claude Code prompt and technical decisions
- `release.md` — what was built, files changed, migrations, known issues

See [documents/README.md](documents/README.md) for the full index.

---

WhatsApp-based household expense tracker. Your helper sends receipt photos to a WhatsApp group → automatic OCR → weekly dashboard with category breakdown and reimbursement total.

## How it works

1. Helper posts a receipt photo to the WhatsApp group
2. Homly detects the image, runs OCR via Gemini Flash
3. Receipt is saved to the database (vendor, total, line items, category)
4. Dashboard shows this week's spending by category
5. Every Friday at 6pm SGT, a summary is sent back to the WhatsApp group

---

## Project structure
homly/
├── backend/
│   ├── agents/
│   │   └── receipt_agent.py       # Gemini Flash OCR logic
│   ├── api/
│   │   ├── middleware/
│   │   │   └── auth.py            # Supabase JWT verification
│   │   ├── dependencies/
│   │   │   └── limiter.py         # Rate limiting
│   │   └── routers/
│   │       └── expenses.py        # All API endpoints
│   ├── migrations/
│   │   └── 001_homly.sql          # DB schema
│   ├── services/
│   │   └── llm_client.py          # OpenRouter facade
│   ├── whatsapp/
│   │   ├── index.js               # Baileys listener + cron summary
│   │   ├── package.json
│   │   └── .env.example
│   ├── main.py                    # FastAPI entrypoint
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/
    │   ├── dashboard/page.tsx     # This week view
    │   ├── history/page.tsx       # Past weeks
    │   ├── login/page.tsx         # Auth
    │   └── components/
    │       └── Navbar.tsx
    ├── lib/
    │   ├── supabase.ts            # Supabase client
    │   └── axios.ts               # Axios with JWT interceptor
    └── .env.example

---

## Prerequisites

- Node.js 18+
- Python 3.11+
- A [Supabase](https://supabase.com) project (free tier)
- An [OpenRouter](https://openrouter.ai) account with Gemini Flash enabled (~$5 credit lasts months)
- A [Railway](https://railway.app) account (for backend + WhatsApp bot)
- A [Vercel](https://vercel.com) account (for frontend)

---

## 1. Supabase setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the contents of `backend/migrations/001_homly.sql`
3. Go to **Authentication → Users** and create a user (your login for the dashboard)
4. Note down from **Project Settings → API**:
   - Project URL
   - `anon` key (public)
   - `service_role` key (secret — used by backend only)
   - JWT secret (under **Data API** → **JWT Settings**)
5. Note the user's UUID from Authentication → Users (you'll need it as `HOMLY_USER_ID`)

---

## 2. OpenRouter setup

1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Add $5 credit (lasts ~6 months at typical usage)
3. Create an API key under **Keys**

---

## 3. Run locally

### Backend (FastAPI)
```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Fill in .env (see variables below)

uvicorn api.main:app --reload --port 8000
```

Backend env variables (`backend/.env`):
```
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_KEY=your_service_role_key
SUPABASE_JWT_SECRET=your_jwt_secret
OPENROUTER_API_KEY=your_openrouter_key
INTERNAL_KEY=homly-internal            # shared secret for /internal/* endpoints
```

### WhatsApp bot
```bash
cd backend/whatsapp
npm install

cp .env.example .env
# Fill in .env (see variables below)

npm start
# Scan the QR code with WhatsApp → Linked Devices → Link a Device
```

WhatsApp bot env variables (`backend/whatsapp/.env`):
```
FASTAPI_URL=http://localhost:8000
SUPABASE_KEY=your_service_role_key     # same key as backend — never expires, no refresh needed
INTERNAL_KEY=homly-internal            # shared secret for /internal/* endpoints
```

### Frontend (Next.js)
```bash
cd frontend
npm install

cp .env.example .env.local
# Fill in .env.local (see variables below)

npm run dev
# Open http://localhost:3000
```

Frontend env variables (`frontend/.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 4. Deploy to production

### Backend → Railway

1. Push repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Create **Service 1** (FastAPI):
   - Root directory: `backend`
   - Start command: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
   - Add all backend env variables
4. Create **Service 2** (WhatsApp bot):
   - Root directory: `backend/whatsapp`
   - Start command: `npm start`
   - Add all WhatsApp env variables
   - Set `FASTAPI_URL` to your Railway FastAPI service URL
   - Open logs → scan QR code with WhatsApp

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import repo
2. Root directory: `frontend`
3. Add env variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   NEXT_PUBLIC_API_URL=https://your-railway-fastapi-url.up.railway.app
   ```
4. Deploy

Update CORS in `backend/api/main.py` to include your Vercel URL:
```python
allow_origins=[
    "https://your-app.vercel.app",
    "http://localhost:3000",
],
```

---

## 5. Test the OCR manually
```bash
cd backend
python -m agents.receipt_agent path/to/receipt.jpg
```

This prints the full JSON output — useful for verifying Gemini Flash is working before connecting WhatsApp.

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/process-receipt` | Upload receipt image (called by WhatsApp bot) |
| GET | `/this-week` | Current week summary |
| GET | `/weeks` | List all weeks with receipts |
| GET | `/weeks/{year}/{week}` | Full detail for a specific week |
| GET | `/receipts/{id}` | Single receipt with line items |
| PATCH | `/receipts/{id}/flag` | Toggle flagged status |

All endpoints except `/process-receipt` require a Supabase JWT in the `Authorization: Bearer` header.

---

## Estimated costs

| Service | Cost |
|---------|------|
| Railway (backend + WhatsApp) | ~$5/month |
| Supabase | Free tier |
| Vercel | Free tier |
| OpenRouter (Gemini Flash) | ~$0.10/month (20 receipts/week) |
| **Total** | **~$5/month** |

---

## Troubleshooting

**WhatsApp bot not detecting images**
- Check `GROUP_NAME` matches exactly (case-sensitive, including spaces)
- Make sure the bot account is a member of the group
- Check Railway logs for connection errors

**OCR returning low confidence**
- Receipt image too blurry or dark → ask helper to retake
- Partially cut off → ensure full receipt is in frame
- Handwritten receipts → limited support, flag manually

**QR code won't appear / spinner stuck**
- Click **"Generate QR code"** on the setup page — this signals the bot to restart its connection
- If the button doesn't help, check Railway logs for the WhatsApp bot service; the bot may have crashed
- After the bot reconnects, the QR appears on the setup page within ~10 seconds

**QR code expired before scanning**
- Click **"QR expired? Generate a new one"** on the setup page
- WhatsApp QR codes expire after ~20 seconds; the bot will generate a fresh one immediately

**Receipt flagged for review**
- Open dashboard → click the receipt → toggle flag after manual verification
- Flagged receipts are still included in weekly totals
