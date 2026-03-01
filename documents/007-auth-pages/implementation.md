# 007 — Auth Pages (Password Reset + Magic Link)

## Problem
Login page had no password reset or magic link flows. Users locked out of their account had no self-service recovery path.

## Solution
- Three-mode login page: password login / forgot password / magic link
- Dedicated `/auth/reset-password` page that handles the Supabase `PASSWORD_RECOVERY` callback
- Dedicated `/auth/magic-link` page that handles the Supabase `SIGNED_IN` callback and routes to dashboard or onboarding
- `redirectTo` uses `window.location.origin` at runtime (not a build-time env var) so it always matches the current deployment

## Technical notes
- Supabase sends auth callback tokens in the URL hash, not the query string — both callback pages listen for `onAuthStateChange` rather than parsing the URL manually
- `auth/magic-link` checks household membership before routing: `/household` endpoint → dashboard if has household, onboarding if not
- `auth/magic-link` has an 8-second timeout fallback in case the auth event never fires
- `window.location.origin` avoids the problem of `NEXT_PUBLIC_SITE_URL` being baked at build time — if the domain changes or a preview deployment is used, the redirect still works
- The three modes share a single email input field; mode switches clear error and sent state
