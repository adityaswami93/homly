# 016 — Landing Page — Release

## What was built

Public-facing landing page at `/` with waitlist email capture. Replaces the old redirect to `/dashboard`. Visitors can learn about the product and join the waitlist without signing in.

## Files changed

- `frontend/app/page.tsx` — full landing page (hero, how-it-works, features, pricing, FAQ, CTA, footer)
- `frontend/lib/config.ts` — new central branding config (appName, tagline, description, siteUrl)
- `frontend/app/api/waitlist/route.ts` — Next.js route handler: POST email → Supabase `waitlist` table
- `frontend/app/login/page.tsx` — footer updated: "Homly is a private household tool." → "← Back to home" link
- `backend/migrations/016_waitlist.sql` — creates `waitlist` table

## Database migrations

Run in Supabase SQL Editor:

```
backend/migrations/016_waitlist.sql
```

Creates: `waitlist(id, email UNIQUE, created_at)`
RLS: disabled (server-only inserts via service role key)

## Environment variables

> **⚠️ SUPERSEDED — do not follow the `SUPABASE_SERVICE_ROLE_KEY` steps below.**
> The waitlist moved server-side to `backend/api/routers/waitlist.py`; there is no
> Next.js route handler using that key any more, and `frontend/.env.example` does
> not list it. Adding a service role key to a Vercel frontend environment puts an
> RLS-bypassing, every-table credential one `NEXT_PUBLIC_` typo away from the
> browser. If it was ever set there, remove it from the Vercel project and rotate
> the key. Left in place below as the historical record. See
> `documents/040-service-role-key-audit/`.

Frontend (`frontend/.env.local`):

| Variable | Required | Notes |
|----------|----------|-------|
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side only — used by the waitlist route handler |
| `NEXT_PUBLIC_SITE_URL` | No | Falls back to `https://homly-six.vercel.app` |

> `NEXT_PUBLIC_SUPABASE_URL` is already set — the waitlist route reuses it.

## Deployment

No backend (FastAPI/Railway) changes. Frontend-only deploy to Vercel.

1. Run `016_waitlist.sql` in Supabase SQL Editor
2. Add `SUPABASE_SERVICE_ROLE_KEY` to Vercel environment variables (Production + Preview, **not** exposed as `NEXT_PUBLIC_`)
3. Deploy frontend to Vercel as normal

## Known issues

None.
