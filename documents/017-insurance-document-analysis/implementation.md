# 017 — Insurance Document Analysis

## Problem

Insurance policies in Homly were entered manually, field by field. Users had to read their policy documents themselves, interpret the coverage terms, and transcribe numbers into the form. This created friction for onboarding new policies and gave no structured understanding of what each policy actually covers.

Additionally, the platform had no way to answer the question "Am I covered for X?" — a question that requires understanding coverage across multiple policies simultaneously.

## Solution

Three interconnected features:

1. **Document upload + AI extraction** — Users can drop a PDF or photo of their insurance policy document into the Add/Edit Policy modal. Gemini 2.5 Flash (via OpenRouter) analyses the document and auto-fills all 9 form fields plus generates a structured coverage summary. The original document is stored in Supabase Storage.

2. **AI policy summary** — After analysis, the modal shows a collapsible panel with a 2–3 sentence plain English summary, a list of covered events (✓), a list of exclusions (✕), plus deductible and waiting period if found.

3. **Coverage Checker** — A new `/insurance/coverage` page lets users type natural language questions ("Am I covered if I'm hospitalised overseas?") and get an LLM-powered answer sourced from their stored `coverage_details` JSON across all analyzed policies, with relevant policy excerpts cited.

## Claude Code prompt

```
We want to expand the insurance mode to take in a document, analyze the document for the type of policy, extract the required parameters and show a professional summarized output of document. Long term goal is to be able query information from their insurance document across multiple insurance policies. One of the goal is to check whether the user is covered under different aspects of life
```

## Technical notes

### Vision LLM

Reuses the existing `get_vision_completion(prompt, image_bytes, mime_type)` function from `services/llm_client.py`. Gemini 2.5 Flash supports `application/pdf` as a native content type via base64 data URL — no PDF-to-image conversion required.

### Two-step save flow

`POST /insurance/analyze` is intentionally separate from `POST /insurance`. The analyze endpoint:
1. Validates file type (JPEG/PNG/WEBP/PDF) and size (≤ 20 MB)
2. Uploads the document to Supabase Storage (`insurance-documents` bucket)
3. Runs AI extraction
4. Returns extracted fields + a signed URL

The user reviews the pre-filled form before saving. The final `POST /insurance` (or `PUT /insurance/{id}`) includes `document_path`, `document_summary`, and `coverage_details` as optional body fields — they're passed through `model_dump(exclude_none=True)` with no endpoint changes needed.

### Storage path convention

`{household_id}/{uuid}.{ext}` — consistent with the `receipts` bucket convention (`{household_id}/{date}/{uuid}.{ext}`), but without the date subfolder since insurance documents are not date-keyed.

A separate private `insurance-documents` bucket is used rather than mixing with receipts. Storage RLS allows household members to read their own household's documents by matching the first path segment to their `household_id`.

### coverage_details schema

```json
{
  "covered": ["list of covered events/conditions"],
  "exclusions": ["list of explicit exclusions"],
  "limits": {
    "hospitalization": "amount as string or null",
    "outpatient": "...",
    "dental": "...",
    "death_benefit": "...",
    "other": {}
  },
  "waiting_period": "text or null",
  "deductible": "amount as string or null",
  "beneficiaries": ["names"]
}
```

Stored as JSONB with a GIN index for future query performance. For the Coverage Checker, the full JSONB is serialised into an LLM prompt context string rather than queried via SQL operators.

### Coverage Checker query pattern

`POST /insurance/query-coverage` fetches all policies with non-null `coverage_details`, formats them as a text block, and calls `get_completion()` (text-only, no vision). Returns `{ answer, relevant_policies[], confidence }`. Returns 422 if no analyzed policies exist, prompting the user to upload documents first.

### Auto-fill safety

`handleFile` only overwrites form fields that are currently empty. It also validates `coverage_type` against `COVERAGE_TYPES` and `premium_frequency` against `PREMIUM_FREQS` before applying extracted values — if the LLM returns an out-of-range value, the existing field is kept.

### Orphaned document risk

If a user uploads a document, the file is stored immediately (before saving the policy). If they cancel without saving, the uploaded document remains in Storage with no policy row referencing it. This is acceptable for a first implementation. A periodic Storage cleanup job could be added later.
