from fastapi import APIRouter, Request, HTTPException
from services.db import get_supabase
from dotenv import load_dotenv

from services import bot_profile

load_dotenv()

router = APIRouter()
supabase = get_supabase()

DEFAULTS = {
    "summary_day":        6,
    "summary_hour":       9,
    "summary_timezone":   "Asia/Singapore",
    "cutoff_mode":        "last7days",
    "group_name":         None,
    "reimbursement_mode": "all",
    "helper_identifiers": "",
    # Assistant persona + engagement — see services/bot_profile.py. Kept in sync
    # with that module's defaults and the CHECK constraints in
    # migrations/034_bot_personality.sql.
    "bot_name":              bot_profile.DEFAULT_NAME,
    "bot_engagement_mode":   bot_profile.DEFAULT_ENGAGEMENT_MODE,
    "bot_tone":              bot_profile.DEFAULT_TONE,
    "bot_casual_chat":       True,
    "bot_proactive_enabled": True,
}

# Free-text fields a household can set on the assistant, with the limits the DB
# doesn't enforce. bot_name is matched against message text as a word (see
# bot_profile.mentions_name), so a blank or one-character name would either
# never match or match constantly.
_BOT_NAME_MAX = 32


def get_or_create_settings(household_id: str) -> dict:
    res = supabase.table("settings").select("*").eq("household_id", household_id).execute()
    if res.data:
        return res.data[0]
    row = {"household_id": household_id, **DEFAULTS}
    supabase.table("settings").insert(row).execute()
    return row


@router.get("/settings")
def get_settings(request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    return get_or_create_settings(household_id)


@router.patch("/settings")
def update_settings(request: Request, body: dict):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    get_or_create_settings(household_id)  # ensure row exists

    allowed = {
        "summary_day", "summary_hour", "summary_timezone", "cutoff_mode", "group_name",
        "group_jid", "reimbursement_mode", "helper_identifiers",
        "bot_name", "bot_engagement_mode", "bot_tone", "bot_casual_chat", "bot_proactive_enabled",
    }
    update = {k: v for k, v in body.items() if k in allowed}

    # Validate the assistant fields here rather than letting the database's
    # CHECK constraints reject the write — a 500 from a constraint violation
    # tells the dashboard nothing it can show the user.
    if "bot_engagement_mode" in update and update["bot_engagement_mode"] not in bot_profile.ENGAGEMENT_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"bot_engagement_mode must be one of {', '.join(bot_profile.ENGAGEMENT_MODES)}",
        )
    if "bot_tone" in update and update["bot_tone"] not in bot_profile.TONES:
        raise HTTPException(
            status_code=400,
            detail=f"bot_tone must be one of {', '.join(bot_profile.TONES)}",
        )
    if "bot_name" in update:
        name = (update["bot_name"] or "").strip()
        if len(name) < 2 or len(name) > _BOT_NAME_MAX:
            raise HTTPException(
                status_code=400,
                detail=f"bot_name must be between 2 and {_BOT_NAME_MAX} characters",
            )
        update["bot_name"] = name
    for flag in ("bot_casual_chat", "bot_proactive_enabled"):
        if flag in update:
            update[flag] = bool(update[flag])

    update["updated_at"] = "now()"

    supabase.table("settings").update(update).eq("household_id", household_id).execute()
    return get_or_create_settings(household_id)


