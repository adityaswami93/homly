// The backend's base URL, trailing slash removed.
//
// NEXT_PUBLIC_API_URL is sometimes configured with one (the Railway dashboard
// hands the URL over that way). Every caller concatenates a leading "/" onto
// it, so that single character produces "//household" — which FastAPI 404s.
// It happened in production on the sign-in flow (Railway logs, 2026-09-12
// 05:54 and 05:59): the 404 body has no `id`, so the household check in
// app/auth/*/page.tsx read it as "no household yet" and bounced returning
// members to /onboarding.
//
// This lives apart from lib/axios.ts so the landing page can import it without
// pulling in the Supabase browser client that axios.ts constructs at import.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "")
