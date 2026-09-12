import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form
from typing import Optional
from services.db import get_supabase
import logging

from agents.recipe_agent import analyse_dish_with_pantry
from services.shopping_list import add_auto_item

logger = logging.getLogger(__name__)
router = APIRouter()

ACCEPTED_MIME_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic",
}

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
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

    analysis = analyse_dish_with_pantry(image_bytes, content_type, household_id, _db())

    if "error" in analysis and not analysis.get("ingredients") and analysis.get("dish") is None:
        logger.warning(f"[recipe/scan] analysis error: {analysis.get('error')}")

    ingredients = analysis.get("ingredients") or []

    added_count = 0
    for ing in ingredients:
        if ing.get("pantry_staple"):
            continue
        # Only add to shopping list if not already in stock
        pantry_status = ing.get("pantry_status", "unknown")
        if pantry_status == "in_stock":
            continue
        canonical = (ing.get("canonical_name") or ing.get("name") or "").strip().lower()
        if not canonical:
            continue
        if add_auto_item(_db(), household_id, canonical, category=ing.get("category", "other"), added_by="recipe"):
            added_count += 1

    return {
        **analysis,
        "items_added_to_shopping_list": added_count,
    }
