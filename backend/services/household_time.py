"""The household's local date — for any rule phrased in calendar days.

"Expires on 30 Nov" means the end of 30 Nov *where the household lives*, not
in UTC: a Singapore household checking a voucher at 07:00 on 1 Dec would
otherwise still see it as valid for another eight hours. settings.summary_timezone
is the only timezone a household records, so it is the one used here.
"""
import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo

from services.db import get_supabase

logger = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "Asia/Singapore"


def household_timezone(household_id: str) -> ZoneInfo:
    tz_name = DEFAULT_TIMEZONE
    if household_id:
        try:
            res = (
                get_supabase().table("settings")
                .select("summary_timezone")
                .eq("household_id", household_id)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            if rows and rows[0].get("summary_timezone"):
                tz_name = rows[0]["summary_timezone"]
        except Exception as e:
            logger.warning(f"[household_time] timezone lookup failed for {household_id}: {e}")
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return ZoneInfo(DEFAULT_TIMEZONE)


def household_today(household_id: str) -> date:
    return datetime.now(household_timezone(household_id)).date()
