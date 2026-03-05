# 016 — Landing Page

## Problem

The app root (`/`) redirected straight to `/dashboard`, meaning unauthenticated visitors had no introduction to the product and no way to express interest. There was no waitlist mechanism.

## Solution

- Full public landing page at `/` with hero, how-it-works, features, pricing, and FAQ sections
- Waitlist form (email capture) with server-side persistence to a `waitlist` table in Supabase
- Central branding config at `frontend/lib/config.ts` so copy/URLs can be updated in one place
- Login page back-link (`← Back to home`) added to footer

## Technical notes

- `frontend/app/page.tsx` replaced the previous one-line redirect with a full `"use client"` landing page
- `WaitlistForm` component calls `POST /api/waitlist` (Next.js route handler), which uses the Supabase service role key to insert rows — the anon key cannot bypass RLS on a server-managed table
- `FaqItem` is an accordion component with CSS `rotate-45` on the `+` icon for open state
- `frontend/app/api/waitlist/route.ts` is a Next.js App Router route handler (no FastAPI involvement — purely frontend → Supabase)
- Duplicate emails (Postgres unique constraint `23505`) are silently treated as success from the user's perspective
- `SUPABASE_SERVICE_ROLE_KEY` is required in `frontend/.env.local` (server-side only, never exposed to browser)
- `NEXT_PUBLIC_SITE_URL` optional env var for the config's `siteUrl`; falls back to the Vercel deployment URL
- RLS is disabled on `waitlist` table — it is insert-only from the server route, not accessed by users directly
