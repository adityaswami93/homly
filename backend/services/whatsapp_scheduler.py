import os
import logging
from datetime import date, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from supabase import create_client

from services.whatsapp_client import send_text

logger = logging.getLogger(__name__)

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


async def _send_weekly_summary(group_jid: str, household_id: str, cutoff_mode: str):
    from api.routers.messages import build_last7days_total, build_week_total
    try:
        if cutoff_mode == "last7days":
            text = await build_last7days_total(household_id)
        else:
            text = await build_week_total(household_id)
        await send_text(group_jid, text)
        logger.info(f"[scheduler] Summary sent to {group_jid}")
    except Exception as e:
        logger.error(f"[scheduler] Summary failed for {group_jid}: {e}")


async def _check_insurance_renewals():
    logger.info("[scheduler] Checking insurance renewals...")
    today = date.today()
    target_dates = [
        (today + timedelta(days=30)).isoformat(),
        (today + timedelta(days=7)).isoformat(),
    ]
    for i, target_date in enumerate(target_dates):
        days_left = 30 if i == 0 else 7
        try:
            res = (
                _db().table("insurance_policies")
                .select("*, settings!inner(group_jid)")
                .eq("renewal_date", target_date)
                .eq("is_active", True)
                .execute()
            )
            for policy in res.data or []:
                group_jid = (policy.get("settings") or {}).get("group_jid")
                if not group_jid:
                    continue
                renewal_str = date.fromisoformat(policy["renewal_date"]).strftime("%-d %b %Y")
                premium_line = ""
                if policy.get("premium_amount"):
                    premium_line = f"\nPremium: ${float(policy['premium_amount']):.2f} / {policy.get('premium_frequency', 'period')}"
                msg = (
                    f"🔔 *Insurance Renewal Reminder*\n\n"
                    f"Your *{policy['coverage_type']}* insurance with *{policy['provider']}* "
                    f"renews in *{days_left} days* ({renewal_str}).\n\n"
                    f"Policy #: {policy.get('policy_number') or '—'}"
                    f"{premium_line}\n\n"
                    f"Make sure your payment is up to date!"
                )
                await send_text(group_jid, msg)
        except Exception as e:
            logger.error(f"[scheduler] Renewal check failed for {target_date}: {e}")


def refresh_summaries(scheduler: AsyncIOScheduler):
    """Load all household settings and reschedule weekly summary jobs."""
    try:
        res = _db().table("settings").select(
            "household_id, group_jid, summary_day, summary_hour, summary_timezone, cutoff_mode"
        ).execute()
        settings_list = res.data or []

        active_ids: set[str] = set()
        for s in settings_list:
            if not s.get("group_jid") or not s.get("household_id"):
                continue
            job_id = f"summary_{s['household_id']}"
            active_ids.add(job_id)

            # APScheduler day_of_week: 0=Mon..6=Sun — matches our summary_day column directly
            scheduler.add_job(
                _send_weekly_summary,
                CronTrigger(
                    day_of_week=s.get("summary_day", 6),
                    hour=s.get("summary_hour", 9),
                    minute=0,
                    timezone=s.get("summary_timezone", "Asia/Singapore"),
                ),
                id=job_id,
                args=[s["group_jid"], s["household_id"], s.get("cutoff_mode", "last7days")],
                replace_existing=True,
            )

        # Remove stale jobs
        for job in scheduler.get_jobs():
            if job.id.startswith("summary_") and job.id not in active_ids:
                scheduler.remove_job(job.id)

        logger.info(f"[scheduler] Summaries scheduled for {len(active_ids)} household(s)")
    except Exception as e:
        logger.error(f"[scheduler] Failed to refresh summaries: {e}")


def create_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()

    scheduler.add_job(
        _check_insurance_renewals,
        CronTrigger(hour=9, minute=0, timezone="Asia/Singapore"),
        id="insurance_renewals",
        replace_existing=True,
    )

    scheduler.add_job(
        refresh_summaries,
        "interval",
        minutes=5,
        id="refresh_summaries",
        args=[scheduler],
    )

    return scheduler
