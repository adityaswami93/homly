import os
import re
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, field_validator
from services.db import get_supabase
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()
supabase = get_supabase()

TRIGGER_RE = re.compile(r"^[a-z0-9_-]{1,30}$")


class CommandIn(BaseModel):
    trigger: str
    response: str
    description: Optional[str] = None
    enabled: bool = True

    @field_validator("trigger")
    @classmethod
    def validate_trigger(cls, v: str) -> str:
        v = v.lstrip("/").lower().strip()
        if not TRIGGER_RE.match(v):
            raise ValueError("Trigger must be 1-30 chars: letters, digits, _ or -")
        return v

    @field_validator("response")
    @classmethod
    def validate_response(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Response cannot be empty")
        if len(v) > 2000:
            raise ValueError("Response must be 2000 chars or fewer")
        return v


@router.get("/commands")
async def list_commands(request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(403, "No household found")

    res = (
        supabase.table("custom_commands")
        .select("*")
        .eq("household_id", household_id)
        .order("trigger", desc=False)
        .execute()
    )
    return res.data or []


@router.post("/commands", status_code=201)
async def create_command(body: CommandIn, request: Request):
    user = request.state.user
    household_id = user.get("household_id")
    if not household_id:
        raise HTTPException(403, "No household found")

    # Prevent shadowing built-in commands
    RESERVED = {"remind", "help", "start", "stop"}
    if body.trigger in RESERVED:
        raise HTTPException(400, f"/{body.trigger} is a built-in command and cannot be overridden")

    row = {
        "household_id": household_id,
        "trigger": body.trigger,
        "response": body.response,
        "description": body.description,
        "enabled": body.enabled,
        "created_by": user.get("sub"),
    }

    try:
        res = supabase.table("custom_commands").insert(row).execute()
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(409, f"A command /{body.trigger} already exists")
        raise

    return res.data[0] if res.data else {}


@router.patch("/commands/{command_id}")
async def update_command(command_id: str, body: CommandIn, request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(403, "No household found")

    update = {
        "trigger": body.trigger,
        "response": body.response,
        "description": body.description,
        "enabled": body.enabled,
        "updated_at": "now()",
    }

    try:
        res = (
            supabase.table("custom_commands")
            .update(update)
            .eq("id", command_id)
            .eq("household_id", household_id)
            .execute()
        )
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(409, f"A command /{body.trigger} already exists")
        raise

    if not res.data:
        raise HTTPException(404, "Command not found")
    return res.data[0]


@router.delete("/commands/{command_id}")
async def delete_command(command_id: str, request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(403, "No household found")

    res = (
        supabase.table("custom_commands")
        .delete()
        .eq("id", command_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Command not found")
    return {"deleted": True}


@router.get("/internal/commands")
async def internal_commands(request: Request):
    """Bot fetches all enabled custom commands keyed by household_id."""
    internal_key = os.getenv("INTERNAL_KEY", "homly-internal")
    if request.headers.get("X-Internal-Key") != internal_key:
        raise HTTPException(403, "Forbidden")

    res = (
        supabase.table("custom_commands")
        .select("household_id, trigger, response")
        .eq("enabled", True)
        .execute()
    )
    # Return as { household_id: { trigger: response, ... }, ... }
    by_household: dict = {}
    for row in res.data or []:
        hid = row["household_id"]
        if hid not in by_household:
            by_household[hid] = {}
        by_household[hid][row["trigger"]] = row["response"]

    return {"commands": by_household}
