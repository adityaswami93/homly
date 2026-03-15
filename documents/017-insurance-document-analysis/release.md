# 017 — Insurance Document Analysis — Release

## What was built

Three features that turn uploaded insurance policy documents into structured, queryable coverage data:

- **Document upload in PolicyModal** — drag-and-drop or click-to-browse for PDF/JPEG/PNG/WEBP files up to 20 MB. AI auto-fills all 9 policy form fields on upload.
- **AI policy summary panel** — collapsible section inside the modal showing a plain English summary, covered events (✓ green), exclusions (✕ red), deductible, and waiting period extracted from the document.
- **Coverage Checker page** (`/insurance/coverage`) — natural language query interface. Users type questions like "Am I covered for overseas hospitalisation?" and get an AI-generated answer with relevant policy excerpts cited.
- **Policy list excerpt** — policies with analyzed documents show a truncated `document_summary` below the provider name in the table.

## Files changed

### Backend

| File | Change |
|------|--------|
| `backend/migrations/017_insurance_document.sql` | New — adds `document_path TEXT`, `document_summary TEXT`, `coverage_details JSONB` columns + GIN index to `insurance_policies` |
| `backend/agents/insurance_agent.py` | New — vision LLM agent: extracts 9 policy fields + plain English summary + structured coverage_details from any PDF or image |
| `backend/api/routers/insurance.py` | Extended — `PolicyIn` model gets 3 new optional fields; new endpoints: `POST /insurance/analyze`, `GET /insurance/{id}/document`, `POST /insurance/query-coverage`; new storage helper `upload_insurance_document()` |

### Frontend

| File | Change |
|------|--------|
| `frontend/app/(shell)/insurance/page.tsx` | Extended — `Policy` interface, `EMPTY_FORM`, and `PolicyModal` updated; document upload zone (idle/uploading/done/error states), AI summary panel, form auto-fill logic, `document_summary` excerpt in table row |
| `frontend/app/(shell)/insurance/coverage/page.tsx` | New — Coverage Checker page with query input, example chips, answer display with confidence badge, relevant policy citations, "how it works" guide |
| `frontend/config/apps.ts` | Coverage nav item added to insurance app (`{ label: "Coverage", href: "/insurance/coverage" }`) |

## Database migrations

Run in Supabase SQL Editor **in order**:

```
backend/migrations/017_insurance_document.sql
```

Adds to `insurance_policies`:
- `document_path TEXT` — Supabase Storage path (`{household_id}/{uuid}.ext`)
- `document_summary TEXT` — AI-generated 2–3 sentence plain English summary
- `coverage_details JSONB` — structured extraction: `{ covered[], exclusions[], limits{}, waiting_period, deductible, beneficiaries[] }`
- GIN index on `coverage_details` for future query performance

## Supabase Storage

Create the `insurance-documents` bucket manually in the Supabase Dashboard:

1. **Storage → New bucket**
   - Name: `insurance-documents`
   - Public: **No** (Private)

2. **Add RLS policy** (SQL Editor):

```sql
CREATE POLICY "household members read insurance docs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'insurance-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT household_id::text FROM household_members WHERE user_id = auth.uid()
    )
  );
```

The backend service role key handles all writes — no write RLS policy needed.

## New API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/insurance/analyze` | JWT | Upload document → AI extraction → returns extracted fields + signed URL. Does not save a policy row. |
| `GET` | `/insurance/{id}/document` | JWT | Generate a 1-hour signed URL for a policy's stored document. |
| `POST` | `/insurance/query-coverage` | JWT | Natural language query against all household `coverage_details`. Returns `{ answer, relevant_policies[], confidence }`. 422 if no analyzed policies exist. |

## Environment variables

No new environment variables. `OPENROUTER_API_KEY` (already required for receipt OCR) is reused for the insurance document agent.

## Deployment steps

1. Run `017_insurance_document.sql` in Supabase SQL Editor
2. Create `insurance-documents` Storage bucket (Private) in Supabase Dashboard
3. Add Storage RLS policy (see above)
4. Deploy backend (FastAPI on Railway) — no new env vars required
5. Deploy frontend (Next.js on Vercel) — no new env vars required

## Known issues

- **Orphaned documents**: If a user uploads a document but cancels without saving the policy, the file remains in Storage with no referencing row. Low impact for current usage; a periodic cleanup job can address this later.
- **PDF multi-page**: Gemini receives the full PDF but may focus on the first page for very long documents. Single-page summary documents (the most common format) work best.
- **Coverage Checker accuracy**: Answers are only as good as the AI's extraction of `coverage_details`. Low-confidence extractions (shown with a warning in the modal) may produce less reliable query answers.
