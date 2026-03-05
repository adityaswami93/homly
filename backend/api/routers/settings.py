import os
from fastapi import APIRouter, Request, HTTPException
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

DEFAULTS = {
    "summary_day":        6,
    "summary_hour":       9,
    "summary_timezone":   "Asia/Singapore",
    "cutoff_mode":        "last7days",
    "group_name":         None,
    "reimbursement_mode": "all",
    "helper_identifiers": "",
}


def get_or_create_settings(household_id: str) -> dict:
    res = supabase.table("settings").select("*").eq("household_id", household_id).execute()
    if res.data:
        return res.data[0]
    row = {"household_id": household_id, **DEFAULTS}
    supabase.table("settings").insert(row).execute()
    return row


@router.get("/settings")
def get_settings(request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    return get_or_create_settings(household_id)


@router.patch("/settings")
def update_settings(request: Request, body: dict):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    get_or_create_settings(household_id)  # ensure row exists

    allowed = {"summary_day", "summary_hour", "summary_timezone", "cutoff_mode", "group_name", "group_jid", "reimbursement_mode", "helper_identifiers"}
    update = {k: v for k, v in body.items() if k in allowed}
    update["updated_at"] = "now()"

    supabase.table("settings").update(update).eq("household_id", household_id).execute()
    return get_or_create_settings(household_id)


@router.get("/internal/settings")
async def get_settings_internal(request: Request):
    """Called by WhatsApp bot to get settings for all households"""
    key = request.headers.get("X-Internal-Key")
    if key != os.getenv("INTERNAL_KEY", "homly-internal"):
        raise HTTPException(status_code=403, detail="Forbidden")
    res = supabase.table("settings").select("*").execute()
    return res.data
