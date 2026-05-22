import os
import logging
from fastapi import APIRouter, Request, HTTPException
from supabase import create_client

from api.routers.internal import whatsapp_state

logger = logging.getLogger(__name__)
router = APIRouter()

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


@router.get("/setup/state")
async def setup_state(request: Request):
    household_id = request.state.user.get("household_id")

    group_jid = None
    group_name = None
    if household_id:
        res = _db().table("settings").select("group_jid, group_name").eq("household_id", household_id).execute()
        if res.data:
            group_jid = res.data[0].get("group_jid")
            group_name = res.data[0].get("group_name")

    return {
        "connected": whatsapp_state["connected"],
        "qr": whatsapp_state.get("qr"),
        "groups": whatsapp_state["groups"],
        "group_jid": group_jid,
        "group_name": group_name,
    }


@router.post("/setup/reset-qr")
async def reset_qr():
    whatsapp_state["qr"] = None
    whatsapp_state["qr_requested"] = True
    return {"status": "ok"}
