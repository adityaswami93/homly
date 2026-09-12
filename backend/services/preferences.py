"""Standing household/personal preferences — the memory behind the chat
supervisor and proactive monitor feeling like they remember who they're
talking to instead of starting cold every run.

Upserts are done as an explicit check-then-write rather than a DB-level
ON CONFLICT, because a plain UNIQUE(household_id, sender_phone, key)
constraint treats every NULL sender_phone as distinct — it wouldn't actually
dedupe household-wide preferences (sender_phone IS NULL) the way it dedupes
personal ones.
"""
import logging
from datetime import datetime, timezone as tz

from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
    return _supabase


def get_preferences(household_id: str) -> list[dict]:
    try:
        res = (
            _db().table("household_preferences")
            .select("sender_phone, key, value")
            .eq("household_id", household_id)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.error(f"[preferences] get_preferences failed: {e}")
        return []


def upsert_preference(household_id: str, key: str, value: str, sender_phone: str | None = None) -> bool:
    key = key.strip().lower()
    if not key or not value.strip():
        return False

    try:
        q = (
            _db().table("household_preferences")
            .select("id")
            .eq("household_id", household_id)
            .eq("key", key)
        )
        q = q.is_("sender_phone", "null") if sender_phone is None else q.eq("sender_phone", sender_phone)
        existing = q.execute()

        now = datetime.now(tz.utc).isoformat()
        if existing.data:
            _db().table("household_preferences").update(
                {"value": value.strip(), "updated_at": now}
            ).eq("id", existing.data[0]["id"]).execute()
        else:
            _db().table("household_preferences").insert({
                "household_id": household_id,
                "sender_phone": sender_phone,
                "key":          key,
                "value":        value.strip(),
                "updated_at":   now,
            }).execute()
        return True
    except Exception as e:
        logger.error(f"[preferences] upsert_preference failed: {e}")
        return False


def delete_preference(household_id: str, key: str, sender_phone: str | None = None) -> bool:
    key = key.strip().lower()
    try:
        q = (
            _db().table("household_preferences")
            .delete()
            .eq("household_id", household_id)
            .eq("key", key)
        )
        q = q.is_("sender_phone", "null") if sender_phone is None else q.eq("sender_phone", sender_phone)
        res = q.execute()
        return bool(res.data)
    except Exception as e:
        logger.error(f"[preferences] delete_preference failed: {e}")
        return False


def format_for_prompt(preferences: list[dict], sender_phone: str | None = None) -> str:
    """Render preferences as a short block to fold into a system prompt.

    Household-wide preferences (sender_phone NULL) always apply; personal
    ones are included only when they belong to the current sender.
    """
    household_lines = [f"- {p['key']}: {p['value']}" for p in preferences if p.get("sender_phone") is None]
    personal_lines = [
        f"- {p['key']}: {p['value']}"
        for p in preferences
        if sender_phone and p.get("sender_phone") == sender_phone
    ]

    if not household_lines and not personal_lines:
        return ""

    parts = []
    if household_lines:
        parts.append("Household preferences:\n" + "\n".join(household_lines))
    if personal_lines:
        parts.append("This person's preferences:\n" + "\n".join(personal_lines))
    return "\n\n".join(parts)
