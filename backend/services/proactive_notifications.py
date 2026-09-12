"""Dedup log for agents/proactive_agent.py's notify_household tool.

The proactive monitor runs unprompted on a schedule and re-evaluates the same
conditions (budget status, pantry levels, ...) every run. Without this, a
finding that's still true tomorrow would get re-sent to the group every run
until the underlying condition changes.
"""
import logging
from datetime import datetime, timedelta, timezone as tz

from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
    return _supabase


def was_recently_notified(household_id: str, finding_key: str, cooldown_hours: int) -> bool:
    try:
        res = (
            _db().table("proactive_notification_log")
            .select("last_notified_at")
            .eq("household_id", household_id)
            .eq("finding_key", finding_key)
            .execute()
        )
    except Exception as e:
        logger.error(f"[proactive_notifications] lookup failed: {e}")
        return False  # fail open — better to risk a duplicate than to go silent

    if not res.data:
        return False

    last = res.data[0]["last_notified_at"]
    try:
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
    except ValueError:
        return False

    return datetime.now(tz.utc) - last_dt < timedelta(hours=cooldown_hours)


def record_notified(household_id: str, finding_key: str) -> None:
    try:
        _db().table("proactive_notification_log").upsert(
            {
                "household_id":     household_id,
                "finding_key":      finding_key,
                "last_notified_at": datetime.now(tz.utc).isoformat(),
            },
            on_conflict="household_id,finding_key",
        ).execute()
    except Exception as e:
        logger.error(f"[proactive_notifications] record failed: {e}")
