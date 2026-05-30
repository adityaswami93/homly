import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form
from typing import Optional
from supabase import create_client
import logging

from agents.recipe_agent import analyse_dish

logger = logging.getLogger(__name__)
router = APIRouter()

ACCEPTED_MIME_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic",
}

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


@router.post("/recipe/scan")
async def scan_recipe(
    request: Request,
    file: UploadFile = File(...),
    household_id: Optional[str] = Form(default=None),
    group_jid: Optional[str] = Form(default=None),
    sender_name: Optional[str] = Form(default=None),
    sender_phone: Optional[str] = Form(default=None),
):
    resolved_household = request.state.user.get("household_id")
    if not resolved_household and request.state.user.get("is_service_key"):
        resolved_household = household_id
        if not resolved_household and group_jid:
            s = _db().table("settings").select("household_id").eq("group_jid", group_jid).execute()
            resolved_household = s.data[0]["household_id"] if s.data else None
    if not resolved_household:
        raise HTTPException(status_code=403, detail="No household found")
    household_id = resolved_household

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    content_type = (file.content_type or "image/jpeg").lower().split(";")[0].strip()
    if content_type not in ACCEPTED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. Accepted: images only."
        )

    analysis = analyse_dish(image_bytes, mime_type=content_type)

    if "error" in analysis and not analysis.get("ingredients") and analysis.get("dish") is None:
        logger.warning(f"[recipe/scan] analysis error: {analysis.get('error')}")

    ingredients = analysis.get("ingredients") or []
    non_staples = [i for i in ingredients if not i.get("pantry_staple")]

    added_count = 0
    for ing in non_staples:
        canonical = (ing.get("canonical_name") or ing.get("name") or "").strip().lower()
        if not canonical:
            continue
        try:
            _db().table("shopping_list").upsert(
                {
                    "household_id":   household_id,
                    "canonical_name": canonical,
                    "category":       ing.get("category", "other"),
                    "added_by":       "recipe",
                    "checked":        False,
                },
                on_conflict="household_id,canonical_name",
            ).execute()
            added_count += 1
        except Exception as e:
            logger.error(f"[recipe/scan] upsert failed for {canonical}: {e}")

    return {
        **analysis,
        "items_added_to_shopping_list": added_count,
    }
