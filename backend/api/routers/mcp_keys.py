"""
JWT-authenticated key management for the Homly MCP server — lets household
admins generate/revoke the per-household API key their MCP server config
uses to call /mcp/data/* (see api/routers/mcp_data.py). Surfaced in the
frontend at Settings > MCP.
"""
import os
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from supabase import create_client
from dotenv import load_dotenv

from api.routers.households import require_admin
from services.mcp_auth import generate_key

load_dotenv()

router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


class KeyIn(BaseModel):
    label: Optional[str] = None


def _get_household_id(request: Request) -> str:
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    return household_id


@router.get("/mcp/keys")
def list_keys(request: Request):
    household_id = _get_household_id(request)
    res = supabase.table("mcp_api_keys")\
        .select("id, label, key_prefix, created_at, last_used_at, revoked_at")\
        .eq("household_id", household_id)\
        .order("created_at", desc=True)\
        .execute()
    return res.data


@router.post("/mcp/keys")
def create_key(request: Request, body: KeyIn):
    household_id = _get_household_id(request)
    require_admin(request)

    plaintext, key_hash, key_prefix = generate_key()
    row = {
        "household_id": household_id,
        "key_hash":     key_hash,
        "key_prefix":   key_prefix,
        "label":        body.label,
        "created_by":   request.state.user.get("sub"),
    }
    inserted = supabase.table("mcp_api_keys").insert(row).execute().data[0]
    # Plaintext is returned exactly once — it isn't stored anywhere.
    return {**inserted, "key": plaintext}


@router.delete("/mcp/keys/{key_id}")
def revoke_key(key_id: str, request: Request):
    household_id = _get_household_id(request)
    require_admin(request)

    existing = supabase.table("mcp_api_keys")\
        .select("household_id")\
        .eq("id", key_id)\
        .execute()
    if not existing.data or existing.data[0]["household_id"] != household_id:
        raise HTTPException(status_code=404, detail="Key not found")

    supabase.table("mcp_api_keys").update({"revoked_at": "now()"}).eq("id", key_id).execute()
    return {"status": "ok"}
