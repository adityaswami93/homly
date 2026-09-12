"""WhatsApp pairing endpoints for the dashboard's /setup page.

A note on what `whatsapp_state` actually is, because it governs who may read
these responses. It is a single module-global dict in api/routers/internal.py,
written by the one bot process (`BOT_TENANT_ID`) that serves every household.
The `qr` in it is therefore not one household's credential — scanning it pairs
the shared bot to the scanner's WhatsApp account, which disconnects every
other household and hands that account control of the bot's identity. The
`groups` list is likewise every group the bot can see, across all tenants.

So both fields, and the reset that regenerates them, are gated on household
admin here. That is narrower than it was (any authenticated user of any
household could read the QR, and `/setup/reset-qr` required no credential at
all), but it is still cross-tenant by construction: an admin of household A
can pair the bot that household B depends on.

Properly fixing that means one bot process per tenant — `BOT_TENANT_ID` and
the `whatsapp_auth.tenant_id` column are already keyed for it — with this
state moved out of a module global and into a per-tenant row. That is a
deliberate follow-up, not part of this change; see
documents/039-service-role-key-audit/implementation.md.
"""
import os
import logging
from fastapi import APIRouter, Request, HTTPException
from supabase import create_client

from api.routers.internal import whatsapp_state
from api.routers.households import require_admin

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

    # `connected` is a harmless status light — the Subnav badge shows it to
    # every member. The pairing QR and the cross-tenant group list are not, so
    # non-admins get them as null/empty rather than a 403: the page still
    # renders, it just can't be used to pair.
    is_admin = (
        request.state.user.get("role") == "admin"
        or request.state.user.get("is_super_admin") is True
    )

    return {
        "connected": whatsapp_state["connected"],
        "qr": whatsapp_state.get("qr") if is_admin else None,
        "groups": whatsapp_state["groups"] if is_admin else [],
        "group_jid": group_jid,
        "group_name": group_name,
        "can_manage": is_admin,
    }


@router.post("/setup/reset-qr")
async def reset_qr(request: Request):
    """Drop the bot's WhatsApp session and ask it for a fresh pairing QR.

    Destructive for every household, not just the caller's — see the module
    docstring. Admin-only, and no longer reachable without a JWT.
    """
    require_admin(request)
    if not request.state.user.get("household_id"):
        raise HTTPException(status_code=403, detail="No household found")

    logger.warning(
        "WhatsApp QR reset requested by user %s (household %s)",
        request.state.user.get("sub"),
        request.state.user.get("household_id"),
    )
    whatsapp_state["qr"] = None
    whatsapp_state["qr_requested"] = True
    return {"status": "ok"}
