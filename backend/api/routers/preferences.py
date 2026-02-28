from fastapi import APIRouter, Request
from supabase import create_client
from datetime import datetime
import os

router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


@router.get("/preferences")
def get_preferences(request: Request):
    user_id = request.state.user["sub"]
    response = supabase.table("user_preferences")\
        .select("*")\
        .eq("user_id", user_id)\
        .execute()
    if response.data:
        return response.data[0]
    return {
        "digest_enabled": True,
        "digest_time": "07:00",
        "digest_frequency": "daily",
        "topics": ["global markets", "Singapore economy", "Federal Reserve", "inflation"]
    }


@router.post("/preferences")
def save_preferences(request: Request, prefs: dict):
    user_id = request.state.user["sub"]
    prefs["user_id"] = user_id
    existing = supabase.table("user_preferences")\
        .select("id")\
        .eq("user_id", user_id)\
        .execute()
    if existing.data:
        supabase.table("user_preferences")\
            .update({**prefs, "updated_at": datetime.utcnow().isoformat()})\
            .eq("user_id", user_id)\
            .execute()
    else:
        supabase.table("user_preferences").insert(prefs).execute()
    return {"status": "saved"}
