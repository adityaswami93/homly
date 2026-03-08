import os
from datetime import date, timedelta
from typing import Optional
import logging

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)
router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

VALID_COVERAGE_TYPES = {"health", "life", "home", "car", "travel", "other"}
VALID_FREQS = {"monthly", "quarterly", "annually"}


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


@router.get("/insurance")
def list_policies(request: Request, household_id: str = None):
    """List all active insurance policies for the user's household."""
    # Support service-key calls (bot) that pass household_id as query param
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

    # Verify ownership
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


@router.get("/internal/insurance/renewals")
async def get_upcoming_renewals(request: Request):
    """
    Internal endpoint: returns policies renewing in exactly 30 or 7 days from today (SGT).
    Called by the WhatsApp bot scheduler.
    """
    from datetime import timezone
    import pytz

    key = request.headers.get("X-Internal-Key")
    if key != os.getenv("INTERNAL_KEY", "homly-internal"):
        raise HTTPException(status_code=403, detail="Forbidden")

    sgt = pytz.timezone("Asia/Singapore")
    today_sgt = date.today()  # SGT date approximation (server time)

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
