# Release Notes

---

## Platform Shell — Insurance AI + Google Login
**Date:** 2026-03-15

### New Features

#### Insurance Document Analysis
Upload a policy document (PDF or image) directly in the Insurance app. AI extracts all policy fields automatically and stores structured coverage details so you can query them in plain English.

- **Document upload** — drag-and-drop or click to upload on the Policies page; supports PDF, JPEG, PNG, WebP up to 20 MB
- **AI extraction** — Gemini vision model reads the document and auto-fills provider, policy number, coverage type, insured person, premium, renewal date, and notes
- **Coverage details** — extracts covered events, exclusions, benefit limits, waiting period, deductible, and beneficiaries into structured JSON
- **Coverage Checker** — new `/insurance/coverage` page; ask plain-English questions ("Am I covered if hospitalised overseas?") and get answers with citations from your actual policies
- **Document storage** — files stored in Supabase `insurance-documents` bucket, scoped per household; signed URL access via `GET /insurance/{id}/document`

#### Google OAuth Login
Users can now sign in with their Google account from the login page.

- "Continue with Google" button added to `/login` (above email/password)
- OAuth redirect handled by new `/auth/callback` page
- On sign-in, users are routed to `/expenses` (existing household) or `/onboarding` (new user)

### Database Changes

Run migration `017_insurance_document.sql` in the Supabase SQL editor:

```sql
-- Adds to insurance_policies:
document_path    TEXT          -- Supabase Storage path
document_summary TEXT          -- AI-generated plain-English summary
coverage_details JSONB         -- structured coverage data (GIN-indexed)
```

**Also required:** Create a private Supabase Storage bucket named `insurance-documents` with RLS allowing household members to read their own objects.

### New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/insurance/analyze` | Upload document → AI extraction → returns fields + summary + coverage_details |
| GET | `/insurance/{id}/document` | Generate signed URL for stored policy document |
| POST | `/insurance/query-coverage` | Natural language query against household coverage_details |

### Infrastructure

- **Supabase Auth:** Enable Google as an OAuth provider (Authentication → Providers → Google). Requires a Google Cloud OAuth 2.0 client with `https://<your-supabase-project>.supabase.co/auth/v1/callback` as an authorised redirect URI.

---

## Previous Releases

See git log for earlier changes.
