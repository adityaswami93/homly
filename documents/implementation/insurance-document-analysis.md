# Implementation: Insurance Document Analysis

## Overview

Users can upload a policy document (PDF or image) in the Insurance app. A vision LLM extracts structured policy data, which is stored in the database and used by the Coverage Checker to answer plain-English questions about household coverage.

---

## Architecture

```
User uploads document (PDF / image)
    ↓
POST /insurance/analyze  (multipart/form-data)
    ↓
upload_insurance_document() → Supabase Storage: insurance-documents/{household_id}/{uuid}.{ext}
    ↓
analyse_insurance_document() → Gemini vision via get_vision_completion()
    ↓
Returns: provider, policy_number, coverage_type, insured_person,
         coverage_amount, premium_amount, premium_frequency, renewal_date,
         notes, summary, coverage_details{}, confidence
    ↓
Frontend auto-fills PolicyModal fields; user reviews + saves via POST /insurance
    ↓
insurance_policies row stored with document_path, document_summary, coverage_details

Coverage Checker:
POST /insurance/query-coverage  { query: "Am I covered for X?" }
    ↓
Fetch all household policies with coverage_details (excludes nulls)
    ↓
get_completion() — LLM synthesises answer from coverage_details JSON
    ↓
Returns: answer, relevant_policies[], confidence
```

---

## Files Changed

### Backend

| File | Change |
|------|--------|
| `backend/agents/insurance_agent.py` | New. Vision LLM agent — sends policy document to Gemini with a structured extraction prompt. Returns parsed JSON with all policy fields + `summary` + `coverage_details`. |
| `backend/api/routers/insurance.py` | Added `POST /insurance/analyze`, `GET /insurance/{id}/document`, `POST /insurance/query-coverage`. Extended `PolicyIn` model with `document_path`, `document_summary`, `coverage_details`. |
| `backend/migrations/017_insurance_document.sql` | Adds `document_path TEXT`, `document_summary TEXT`, `coverage_details JSONB` to `insurance_policies`. GIN index on `coverage_details`. |

### Frontend

| File | Change |
|------|--------|
| `frontend/app/(shell)/insurance/page.tsx` | Policies list shows `document_summary` excerpt. PolicyModal: drag-and-drop upload zone, "Analyzing…" spinner, auto-fill from extracted fields, collapsible AI summary with covered / exclusions / limits sections. |
| `frontend/app/(shell)/insurance/coverage/page.tsx` | New. Coverage Checker page: plain-English query input, example chips, answer card with confidence badge, relevant policy citations. |
| `frontend/config/apps.ts` | Added "Coverage" nav item to insurance app. |

---

## API Reference

### `POST /insurance/analyze`

Upload a policy document for AI extraction. **Auth:** JWT (household member).

**Request:** `multipart/form-data`
- `file` — PDF, JPEG, PNG, or WebP; max 20 MB

**Response `200`:**
```json
{
  "provider": "AIA Singapore",
  "policy_number": "A123456789",
  "coverage_type": "health",
  "insured_person": "John Doe",
  "coverage_amount": 500000.00,
  "premium_amount": 250.00,
  "premium_frequency": "monthly",
  "renewal_date": "2026-12-31",
  "notes": "Deductible: $3,500. Waiting period: 30 days for pre-existing conditions.",
  "summary": "Health insurance covering hospitalisation up to $500k per year. Includes outpatient at $150/visit. Excludes pre-existing conditions for first 12 months.",
  "coverage_details": {
    "covered": ["Hospitalisation", "Surgery", "Day surgery", "Outpatient specialist"],
    "exclusions": ["Pre-existing conditions (first 12 months)", "Cosmetic surgery", "Dental"],
    "limits": {
      "hospitalization": "$500,000/year",
      "outpatient": "$150/visit, up to 30 visits/year",
      "dental": null,
      "death_benefit": null,
      "other": {}
    },
    "waiting_period": "30 days for pre-existing conditions",
    "deductible": "SGD 3,500",
    "beneficiaries": []
  },
  "document_path": "abc123.../uuid.pdf",
  "confidence": "high"
}
```

**Error `422`:** Unsupported file type or file too large.

---

### `GET /insurance/{id}/document`

Returns a signed URL (1 hour) for the stored policy document. **Auth:** JWT.

**Response `200`:**
```json
{ "url": "https://storage.supabase.co/..." }
```

**Error `404`:** Policy not found or no document attached.

---

### `POST /insurance/query-coverage`

Answer a natural-language question using the household's analyzed policies. **Auth:** JWT.

**Request:**
```json
{ "query": "Am I covered if hospitalised overseas?" }
```

**Response `200`:**
```json
{
  "answer": "Yes, based on your AIA health policy you are covered for overseas hospitalisation up to S$500,000 per year under the Emergency Overseas Treatment benefit.",
  "relevant_policies": [
    {
      "provider": "AIA Singapore",
      "coverage_type": "health",
      "policy_number": "A123456789",
      "relevant_excerpt": "Emergency Overseas Treatment: covers hospitalisation costs incurred overseas up to policy annual limit."
    }
  ],
  "confidence": "high"
}
```

**Error `422`:** No policies with `coverage_details` found for the household.

---

## Database

### Migration `017_insurance_document.sql`

```sql
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS document_path TEXT;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS document_summary TEXT;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS coverage_details JSONB;

CREATE INDEX IF NOT EXISTS insurance_policies_coverage_details_gin
  ON insurance_policies USING GIN (coverage_details)
  WHERE coverage_details IS NOT NULL;
```

### `coverage_details` JSONB Shape

```json
{
  "covered": ["string"],
  "exclusions": ["string"],
  "limits": {
    "hospitalization": "string | null",
    "outpatient": "string | null",
    "dental": "string | null",
    "death_benefit": "string | null",
    "other": {}
  },
  "waiting_period": "string | null",
  "deductible": "string | null",
  "beneficiaries": ["string"]
}
```

---

## Supabase Storage Setup

1. Go to **Storage** in the Supabase dashboard.
2. Create a new bucket named **`insurance-documents`** — set to **Private**.
3. Add an RLS policy allowing read access to household members:

```sql
CREATE POLICY "household members can read own docs"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'insurance-documents'
  AND auth.uid() IN (
    SELECT user_id FROM household_members
    WHERE household_id::text = (storage.foldername(name))[1]
  )
);
```

---

## AI Agent Details

**Model:** Gemini vision (via OpenRouter `get_vision_completion()`)

**Prompt strategy:** Single-shot structured extraction. The prompt defines the exact JSON schema, coverage type enum, premium frequency normalisation rules, and confidence scoring criteria. Monetary amounts are extracted as plain numerics (no currency symbols).

**Confidence levels:**
- `high` — clear document, all key fields readable
- `medium` — some fields unclear but provider and coverage type are readable
- `low` — cannot identify basic policy details; document is blurry or incomplete

**Fallback:** If JSON parsing fails, the agent returns `{ "error": "parse_error", "confidence": "low", ... }`. The frontend surfaces this as a generic analysis error toast.
