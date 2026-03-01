# 007 — Auth Pages — Release

## What was built
Multi-mode login page with password login, forgot password, and magic link. Two new callback pages handle Supabase auth redirects.

## Files changed
- `frontend/app/login/page.tsx` — replaced single-mode login with three-mode flow (login / forgot / magic)
- `frontend/app/auth/reset-password/page.tsx` — new; listens for `PASSWORD_RECOVERY` event, shows password update form
- `frontend/app/auth/magic-link/page.tsx` — new; listens for `SIGNED_IN` event, routes to dashboard or onboarding
- `frontend/.env.example` — added `NEXT_PUBLIC_SITE_URL` (informational; not used at runtime, uses `window.location.origin` instead)

## Environment variables
None required. `NEXT_PUBLIC_SITE_URL` was originally planned but replaced with `window.location.origin`.

## Deployment steps
In Supabase → Authentication → URL Configuration:
- Add `<your-domain>/auth/reset-password` to the redirect allow list
- Add `<your-domain>/auth/magic-link` to the redirect allow list

## Known issues
- Magic link page has an 8-second timeout before showing a manual "go to login" link — no spinner shown during the wait
