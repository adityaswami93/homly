import os
import sys
from urllib.parse import unquote
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request, HTTPException, Query
from typing import Optional
from supabase import create_client
from datetime import datetime, timezone
import logging

from services.shopping_list import add_auto_item

logger = logging.getLogger(__name__)
router = APIRouter()

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


def _resolve_household(request: Request, household_id: Optional[str] = None) -> str:
    resolved = request.state.user.get("household_id")
    if not resolved and request.state.user.get("is_service_key"):
        resolved = household_id
    if not resolved:
        raise HTTPException(status_code=403, detail="No household found")
    return resolved


@router.get("/pantry")
def list_pantry(
    request: Request,
    status: Optional[str] = Query(default=None),
):
    household_id = _resolve_household(request)
    q = (
        _db()
        .table("pantry_items")
        .select("*")
        .eq("household_id", household_id)
        .order("category")
        .order("canonical_name")
    )
    if status:
        q = q.eq("status", status)
    res = q.execute()
    return res.data


@router.post("/pantry")
def add_pantry_item(request: Request, body: dict):
    household_id = _resolve_household(request)
    canonical_name = (body.get("canonical_name") or "").strip().lower()
    if not canonical_name:
        raise HTTPException(status_code=400, detail="canonical_name is required")

    now = datetime.now(timezone.utc).isoformat()
    row = {
        "household_id":   household_id,
        "canonical_name": canonical_name,
        "quantity":       body.get("quantity"),
        "unit":           body.get("unit"),
        "category":       body.get("category"),
        "status":         body.get("status", "in_stock"),
        "notes":          body.get("notes"),
        "added_by":       body.get("added_by", "manual"),
        "last_updated":   now,
    }
    res = (
        _db()
        .table("pantry_items")
        .upsert(row, on_conflict="household_id,canonical_name")
        .execute()
    )
    return res.data[0]


@router.patch("/pantry/{canonical_name_encoded}")
def update_pantry_item(canonical_name_encoded: str, request: Request, body: dict):
    household_id = _resolve_household(request)
    canonical_name = unquote(canonical_name_encoded).strip().lower()

    existing = (
        _db()
        .table("pantry_items")
        .select("id")
        .eq("household_id", household_id)
        .eq("canonical_name", canonical_name)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Pantry item not found")

    now = datetime.now(timezone.utc).isoformat()
    updates: dict = {"last_updated": now}
    for field in ("quantity", "unit", "status", "notes"):
        if field in body:
            updates[field] = body[field]

    res = (
        _db()
        .table("pantry_items")
        .update(updates)
        .eq("household_id", household_id)
        .eq("canonical_name", canonical_name)
        .execute()
    )
    if updates.get("status") == "out_of_stock":
        add_auto_item(_db(), household_id, canonical_name)
    return res.data[0]


@router.delete("/pantry/{canonical_name_encoded}")
def delete_pantry_item(canonical_name_encoded: str, request: Request):
    household_id = _resolve_household(request)
    canonical_name = unquote(canonical_name_encoded).strip().lower()

    existing = (
        _db()
        .table("pantry_items")
        .select("id")
        .eq("household_id", household_id)
        .eq("canonical_name", canonical_name)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Pantry item not found")

    _db().table("pantry_items").delete().eq("household_id", household_id).eq("canonical_name", canonical_name).execute()
    return {"status": "ok"}


@router.get("/internal/pantry")
def internal_pantry(
    request: Request,
    household_id: str = Query(...),
):
    internal_key = os.getenv("INTERNAL_KEY", "homly-internal")
    if request.headers.get("X-Internal-Key") != internal_key:
        raise HTTPException(status_code=401, detail="Unauthorized")

    res = (
        _db()
        .table("pantry_items")
        .select("*")
        .eq("household_id", household_id)
        .order("category")
        .order("canonical_name")
        .execute()
    )
    return res.data
