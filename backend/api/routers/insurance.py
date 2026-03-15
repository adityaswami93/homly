import os
import uuid
import json
from datetime import date, timedelta
from typing import Optional

import logging

from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from pydantic import BaseModel
from supabase import create_client
from dotenv import load_dotenv

from agents.insurance_agent import analyse_insurance_document
from services.llm_client import get_completion

load_dotenv()

logger = logging.getLogger(__name__)
router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

VALID_COVERAGE_TYPES = {"health", "life", "home", "car", "travel", "other"}
VALID_FREQS = {"monthly", "quarterly", "annually"}

ALLOWED_DOC_MIME = {"image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"}
MAX_DOC_SIZE = 20 * 1024 * 1024  # 20 MB


class PolicyIn(BaseModel):
    provider: str
    policy_number: Optional[str] = None
    coverage_type: str
    insured_person: Optional[str] = None
    coverage_amount: Optional[float] = None
    premium_amount: Optional[float] = None
    premium_frequency: Optional[str] = None
    renewal_date: Optional[str] = None
    notes: Optional[str] = None
    # Document analysis fields (set after POST /insurance/analyze)
    document_path: Optional[str] = None
    document_summary: Optional[str] = None
    coverage_details: Optional[dict] = None


class CoverageQueryIn(BaseModel):
    query: str


def get_household_id(request: Request) -> str:
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    return household_id


def validate_policy(data: dict) -> None:
    if data.get("coverage_type") and data["coverage_type"] not in VALID_COVERAGE_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid coverage_type: {data['coverage_type']}")
    if data.get("premium_frequency") and data["premium_frequency"] not in VALID_FREQS:
        raise HTTPException(status_code=422, detail=f"Invalid premium_frequency: {data['premium_frequency']}")


def upload_insurance_document(file_bytes: bytes, mime_type: str, household_id: str) -> "str | None":
    """Upload insurance document to Supabase Storage. Returns storage path or None on failure."""
    try:
        ext_map = {
            "image/jpeg": "jpg", "image/jpg": "jpg",
            "image/png": "png", "image/webp": "webp",
            "application/pdf": "pdf",
        }
        ext = ext_map.get(mime_type, "bin")
        filename = f"{uuid.uuid4().hex}.{ext}"
        path = f"{household_id}/{filename}"
        supabase.storage.from_("insurance-documents").upload(
            path=path,
            file=file_bytes,
            file_options={"content-type": mime_type, "upsert": "false"},
        )
        return path
    except Exception as e:
        logger.error(f"[insurance] Document upload failed: {e}")
        return None


@router.get("/insurance")
def list_policies(request: Request, household_id: str = None):
    """List all active insurance policies for the user's household."""
    resolved = request.state.user.get("household_id")
    if not resolved and request.state.user.get("is_service_key"):
        resolved = household_id
    if not resolved:
        raise HTTPException(status_code=403, detail="No household found")
    household_id = resolved
    res = (
        supabase.table("insurance_policies")
        .select("*")
        .eq("household_id", household_id)
        .eq("is_active", True)
        .order("coverage_type")
        .order("renewal_date", nullsfirst=False)
        .execute()
    )
    return res.data


@router.post("/insurance/analyze")
async def analyze_insurance_document_endpoint(
    request: Request,
    file: UploadFile = File(...),
):
    """
    Accept a PDF or image of an insurance policy document.
    Validates, uploads to Supabase Storage, runs AI extraction.
    Returns extracted fields + signed URL. Does NOT save a policy row.
    """
    household_id = get_household_id(request)

    content_type = file.content_type or "application/octet-stream"
    if content_type not in ALLOWED_DOC_MIME:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. Allowed: JPEG, PNG, WEBP, PDF",
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_DOC_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 20 MB)")

    document_path = upload_insurance_document(file_bytes, content_type, household_id)
    if not document_path:
        raise HTTPException(status_code=500, detail="Failed to upload document")

    try:
        signed = supabase.storage.from_("insurance-documents").create_signed_url(
            path=document_path,
            expires_in=3600,
        )
        document_url = signed.get("signedURL")
    except Exception:
        document_url = None

    extraction = analyse_insurance_document(file_bytes, mime_type=content_type)

    return {
        "document_path": document_path,
        "document_url": document_url,
        "extracted": {
            "provider": extraction.get("provider"),
            "policy_number": extraction.get("policy_number"),
            "coverage_type": extraction.get("coverage_type"),
            "insured_person": extraction.get("insured_person"),
            "coverage_amount": extraction.get("coverage_amount"),
            "premium_amount": extraction.get("premium_amount"),
            "premium_frequency": extraction.get("premium_frequency"),
            "renewal_date": extraction.get("renewal_date"),
            "notes": extraction.get("notes"),
        },
        "summary": extraction.get("summary"),
        "coverage_details": extraction.get("coverage_details"),
        "confidence": extraction.get("confidence", "medium"),
        "error": extraction.get("error"),
    }


@router.post("/insurance", status_code=201)
def create_policy(request: Request, body: PolicyIn):
    """Create a new insurance policy for the user's household."""
    household_id = get_household_id(request)
    user_id = request.state.user.get("sub")

    data = body.model_dump(exclude_none=True)
    validate_policy(data)

    data["household_id"] = household_id
    data["created_by"] = user_id
    data["is_active"] = True

    res = supabase.table("insurance_policies").insert(data).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create policy")
    return res.data[0]


@router.put("/insurance/{policy_id}")
def update_policy(policy_id: str, request: Request, body: PolicyIn):
    """Update an existing policy (must belong to the user's household)."""
    household_id = get_household_id(request)

    existing = (
        supabase.table("insurance_policies")
        .select("id")
        .eq("id", policy_id)
        .eq("household_id", household_id)
        .eq("is_active", True)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Policy not found")

    data = body.model_dump(exclude_none=True)
    validate_policy(data)
    data["updated_at"] = "now()"

    res = (
        supabase.table("insurance_policies")
        .update(data)
        .eq("id", policy_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to update policy")
    return res.data[0]


@router.delete("/insurance/{policy_id}", status_code=204)
def deactivate_policy(policy_id: str, request: Request):
    """Soft-delete a policy by marking is_active = false."""
    household_id = get_household_id(request)

    existing = (
        supabase.table("insurance_policies")
        .select("id")
        .eq("id", policy_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Policy not found")

    supabase.table("insurance_policies").update({"is_active": False, "updated_at": "now()"}).eq(
        "id", policy_id
    ).execute()


@router.get("/insurance/{policy_id}/document")
def get_policy_document_url(policy_id: str, request: Request):
    """Generate a signed URL for an insurance policy's stored document."""
    household_id = get_household_id(request)

    policy = (
        supabase.table("insurance_policies")
        .select("document_path, household_id")
        .eq("id", policy_id)
        .eq("household_id", household_id)
        .eq("is_active", True)
        .execute()
    )
    if not policy.data:
        raise HTTPException(status_code=404, detail="Policy not found")

    document_path = policy.data[0].get("document_path")
    if not document_path:
        raise HTTPException(status_code=404, detail="No document stored for this policy")

    result = supabase.storage.from_("insurance-documents").create_signed_url(
        path=document_path,
        expires_in=3600,
    )
    return {"url": result.get("signedURL")}


@router.post("/insurance/query-coverage")
async def query_coverage(request: Request, body: CoverageQueryIn):
    """
    Natural language query against all household's analyzed insurance policies.
    Fetches policies with coverage_details, builds LLM context, returns structured answer.
    """
    household_id = get_household_id(request)

    res = (
        supabase.table("insurance_policies")
        .select("provider, policy_number, coverage_type, coverage_details, document_summary")
        .eq("household_id", household_id)
        .eq("is_active", True)
        .not_.is_("coverage_details", "null")
        .execute()
    )

    if not res.data:
        raise HTTPException(
            status_code=422,
            detail="No analyzed policies found. Upload and analyze policy documents first.",
        )

    policies_context = "\n\n".join([
        f"Policy {i + 1}: {p['provider']} ({p['coverage_type']})"
        f"{' — ' + p['policy_number'] if p.get('policy_number') else ''}\n"
        f"Summary: {p.get('document_summary') or 'N/A'}\n"
        f"Coverage Details: {json.dumps(p['coverage_details'], indent=2)}"
        for i, p in enumerate(res.data)
    ])

    prompt = f"""You are an insurance expert helping a household understand their coverage.

Here are their insurance policies:

{policies_context}

User's question: {body.query}

Return ONLY a JSON object with this schema:
{{
  "answer": "clear, plain English answer based on the policies above (2-4 sentences)",
  "relevant_policies": [
    {{
      "provider": "policy provider name",
      "coverage_type": "policy type",
      "policy_number": "policy number or null",
      "relevant_excerpt": "the specific clause or point that answers the question"
    }}
  ],
  "confidence": "high|medium|low"
}}

Rules:
- Only answer based on the provided policy data — do not invent or assume coverage
- If no policy clearly addresses the question, say so and set confidence to low
- If the document data is insufficient to answer, acknowledge that and suggest reviewing the original policy
- Keep the answer concise and plain English
"""

    try:
        raw = get_completion(prompt)
        clean = raw.strip()
        if clean.startswith("```"):
            parts = clean.split("```")
            clean = parts[1]
            if clean.startswith("json"):
                clean = clean[4:]
            clean = clean.strip()
        return json.loads(clean)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse coverage query response")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.get("/internal/insurance/renewals")
async def get_upcoming_renewals(request: Request):
    """
    Internal endpoint: returns policies renewing in exactly 30 or 7 days from today (SGT).
    Called by the WhatsApp bot scheduler.
    """
    import pytz

    key = request.headers.get("X-Internal-Key")
    if key != os.getenv("INTERNAL_KEY", "homly-internal"):
        raise HTTPException(status_code=403, detail="Forbidden")

    today_sgt = date.today()

    target_dates = [
        (today_sgt + timedelta(days=30)).isoformat(),
        (today_sgt + timedelta(days=7)).isoformat(),
    ]

    results = []
    for target_date in target_dates:
        res = (
            supabase.table("insurance_policies")
            .select("*, settings!inner(group_jid, household_id)")
            .eq("renewal_date", target_date)
            .eq("is_active", True)
            .execute()
        )
        for row in res.data:
            days_left = 30 if target_date == target_dates[0] else 7
            results.append({**row, "days_until_renewal": days_left})

    return results
