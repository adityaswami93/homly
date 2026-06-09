# Implementation: Google OAuth Login

## Overview

Users can sign in with Google via Supabase OAuth. On success they are routed to `/expenses` (existing household) or `/onboarding` (first-time user), matching the behaviour of email/password and magic link login.

---

## Flow

```
User clicks "Continue with Google"
    ↓
supabase.auth.signInWithOAuth({ provider: 'google', redirectTo: '/auth/callback' })
    ↓
Browser navigates to Google consent screen
    ↓
Google redirects to Supabase OAuth callback URL
    ↓
Supabase processes token, redirects to /auth/callback with session in URL fragment
    ↓
/auth/callback: onAuthStateChange fires SIGNED_IN event
    ↓
GET /household with session access_token
    ↓
household.id present → /expenses
household.id absent  → /onboarding
```

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/app/login/page.tsx` | Added `handleGoogleLogin()`. Added "Continue with Google" button at top of login form (above email/password). |
| `frontend/app/auth/callback/page.tsx` | New. Handles the OAuth redirect — listens for `SIGNED_IN` auth state event, checks household, routes accordingly. 10-second timeout fallback shows error state. |

---

## Supabase Configuration (required)

1. Go to **Authentication → Providers → Google** in the Supabase dashboard.
2. Toggle **Enable**.
3. Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com/):
   - Create an OAuth 2.0 Client ID (Web application type)
   - Add **Authorised redirect URI**: `https://<project-ref>.supabase.co/auth/v1/callback`
4. Paste the **Client ID** and **Client Secret** into Supabase.
5. Add the app's production URL to **Authorised JavaScript origins** in Google Cloud Console.

---

## Key Implementation Notes

**`/auth/callback` subscribes and cleans up.** Unlike `/auth/magic-link` (which never unsubscribes), the callback page calls `subscription.unsubscribe()` on unmount and clears the timeout to avoid memory leaks.

**Loading state not reset on OAuth redirect.** When `signInWithOAuth` succeeds, the browser navigates away immediately. `setLoading(false)` is only called on error — this is intentional and prevents a flash of the default button state before navigation.

**Shared `loading` flag.** The Google button is disabled while any auth action is in progress (password login, Google OAuth) since all three flows share the same `loading` state.

**Redirect URL.** The `redirectTo` is set to `window.location.origin + /auth/callback`. This must match one of the **Redirect URLs** allowed in Supabase (Authentication → URL Configuration). Add both `http://localhost:3000/auth/callback` (dev) and the production URL.
