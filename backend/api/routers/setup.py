import os
import logging
from fastapi import APIRouter, Request, HTTPException
from supabase import create_client
from services.whatsapp_client import get_state, get_qr, get_groups, is_configured

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

    state = await get_state()
    is_connected = state.get("stateInstance") == "authorized"

    groups = []
    if is_connected:
        groups = await get_groups()

    # Current group selection for this household
    current_group_jid = None
    current_group_name = None
    if household_id:
        res = _db().table("settings").select("group_jid, group_name").eq("household_id", household_id).execute()
        if res.data:
            current_group_jid = res.data[0].get("group_jid")
            current_group_name = res.data[0].get("group_name")

    return {
        "connected": is_connected,
        "state": state.get("stateInstance"),
        "groups": groups,
        "configured": is_configured(),
        "group_jid": current_group_jid,
        "group_name": current_group_name,
    }


@router.get("/setup/qr")
async def setup_qr():
    data = await get_qr()
    qr_b64 = data.get("message") if data.get("type") == "qrCode" else None
    return {
        "type": data.get("type"),
        "qr": f"data:image/png;base64,{qr_b64}" if qr_b64 else None,
        "error": data.get("message") if data.get("type") not in ("qrCode", "alreadyLogged") else None,
    }
