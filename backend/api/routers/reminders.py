import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


class ReminderIn(BaseModel):
    message: str
    remind_at: datetime
    group_jid: Optional[str] = None


@router.get("/reminders")
async def list_reminders(request: Request):
    user = request.state.user
    household_id = user.get("household_id")
    if not household_id:
        raise HTTPException(403, "No household found")

    res = (
        supabase.table("reminders")
        .select("*")
        .eq("household_id", household_id)
        .eq("sent", False)
        .gte("remind_at", datetime.now(timezone.utc).isoformat())
        .order("remind_at", desc=False)
        .execute()
    )
    return res.data or []


@router.post("/reminders")
async def create_reminder(body: ReminderIn, request: Request):
    user = request.state.user
    household_id = user.get("household_id")
    if not household_id:
        raise HTTPException(403, "No household found")

    # Resolve group_jid: use provided value or fetch from household settings
    group_jid = body.group_jid
    if not group_jid:
        settings_res = (
            supabase.table("settings")
            .select("group_jid")
            .eq("household_id", household_id)
            .maybe_single()
            .execute()
        )
        group_jid = (settings_res.data or {}).get("group_jid")

    if not group_jid:
        raise HTTPException(400, "No WhatsApp group configured for this household")

    row = {
        "household_id": household_id,
        "group_jid": group_jid,
        "sender_jid": user.get("sub") or "web",
        "sender_name": user.get("email") or "Web user",
        "message": body.message,
        "remind_at": body.remind_at.isoformat(),
        "sent": False,
    }
    res = supabase.table("reminders").insert(row).execute()
    return res.data[0] if res.data else {}


@router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str, request: Request):
    user = request.state.user
    household_id = user.get("household_id")
    if not household_id:
        raise HTTPException(403, "No household found")

    res = (
        supabase.table("reminders")
        .delete()
        .eq("id", reminder_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Reminder not found")
    return {"deleted": True}


@router.get("/internal/reminders/due")
async def due_reminders(request: Request):
    """Called by the WhatsApp bot to fetch and mark reminders that are due."""
    internal_key = os.getenv("INTERNAL_KEY", "homly-internal")
    if request.headers.get("X-Internal-Key") != internal_key:
        raise HTTPException(403, "Forbidden")

    now = datetime.now(timezone.utc).isoformat()
    res = (
        supabase.table("reminders")
        .select("*")
        .eq("sent", False)
        .lte("remind_at", now)
        .execute()
    )
    due = res.data or []

    if due:
        ids = [r["id"] for r in due]
        supabase.table("reminders").update({"sent": True}).in_("id", ids).execute()

    return {"reminders": due}
