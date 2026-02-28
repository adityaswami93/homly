import os
from fastapi import APIRouter, Request, HTTPException
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

DEFAULTS = {
    "summary_day":      6,
    "summary_hour":     9,
    "summary_timezone": "Asia/Singapore",
    "cutoff_mode":      "last7days",
    "group_name":       None,
}


def get_or_create_settings(user_id: str) -> dict:
    res = supabase.table("settings").select("*").eq("user_id", user_id).execute()
    if res.data:
        return res.data[0]
    # Create defaults
    row = {"user_id": user_id, **DEFAULTS}
    supabase.table("settings").insert(row).execute()
    return row


@router.get("/settings")
def get_settings(request: Request):
    user_id = request.state.user["sub"]
    return get_or_create_settings(user_id)


@router.patch("/settings")
def update_settings(request: Request, body: dict):
    user_id = request.state.user["sub"]
    get_or_create_settings(user_id)  # ensure row exists

    allowed = {"summary_day", "summary_hour", "summary_timezone", "cutoff_mode", "group_name"}
    update = {k: v for k, v in body.items() if k in allowed}
    update["updated_at"] = "now()"

    supabase.table("settings").update(update).eq("user_id", user_id).execute()
    return get_or_create_settings(user_id)


@router.get("/internal/settings")
async def get_settings_internal(request: Request):
    """Called by WhatsApp bot to get current settings"""
    key = request.headers.get("X-Internal-Key")
    if key != os.getenv("INTERNAL_KEY", "homly-internal"):
        raise HTTPException(status_code=403, detail="Forbidden")
    user_id = os.getenv("HOMLY_USER_ID")
    return get_or_create_settings(user_id)
