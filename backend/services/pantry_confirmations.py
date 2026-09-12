"""Pending pantry confirmations for the WhatsApp grocery-receipt flow.

The bot talks to the backend with one stateless HTTP request per WhatsApp
message, so the "we asked the group a question and are waiting for the reply"
state has to be persisted somewhere both requests can see. It used to rely on
LangGraph's interrupt()/resume, which needs a checkpointer that
``get_graph()`` silently drops when SUPABASE_DB_URL is unset -- and which never
actually resumed, because ``invoke(state, config)`` with a fresh input dict
starts a new run rather than resuming a suspended one.
"""
import logging
from datetime import datetime, timedelta, timezone as tz

from services.db import get_supabase

logger = logging.getLogger(__name__)

# How long a group has to answer "add these to your pantry?" before the
# prompt goes stale and an unrelated "yes" stops being treated as an answer.
PENDING_TTL_HOURS = 24

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
    return _supabase


def save_pending(
    household_id: str,
    group_jid: str,
    candidates: list,
    source: str = "receipt",
    receipt_id: str | None = None,
) -> bool:
    """Record that `group_jid` was asked to confirm `candidates`.

    One pending prompt per group -- a newer receipt supersedes an unanswered
    older one, which is also what the group sees in the chat.
    """
    if not group_jid:
        return False

    expires = datetime.now(tz.utc) + timedelta(hours=PENDING_TTL_HOURS)
    row = {
        "household_id": household_id,
        "group_jid":    group_jid,
        "receipt_id":   receipt_id,
        "source":       source,
        "candidates":   candidates,
        "created_at":   datetime.now(tz.utc).isoformat(),
        "expires_at":   expires.isoformat(),
    }
    try:
        _db().table("pantry_pending_confirmations") \
            .upsert(row, on_conflict="group_jid") \
            .execute()
        return True
    except Exception as e:
        logger.error(f"[pantry_confirmations] save_pending failed: {e}")
        return False


def get_pending(household_id: str, group_jid: str) -> dict | None:
    """Return the live pending prompt for this group, or None."""
    if not group_jid:
        return None
    try:
        res = _db().table("pantry_pending_confirmations") \
            .select("*") \
            .eq("group_jid", group_jid) \
            .eq("household_id", household_id) \
            .execute()
    except Exception as e:
        logger.error(f"[pantry_confirmations] get_pending failed: {e}")
        return None

    if not res.data:
        return None

    pending = res.data[0]
    expires_at = pending.get("expires_at")
    if expires_at:
        try:
            if datetime.fromisoformat(expires_at.replace("Z", "+00:00")) < datetime.now(tz.utc):
                clear_pending(household_id, group_jid)
                return None
        except ValueError:
            pass
    return pending


def clear_pending(household_id: str, group_jid: str) -> None:
    if not group_jid:
        return
    try:
        _db().table("pantry_pending_confirmations") \
            .delete() \
            .eq("group_jid", group_jid) \
            .eq("household_id", household_id) \
            .execute()
    except Exception as e:
        logger.error(f"[pantry_confirmations] clear_pending failed: {e}")
