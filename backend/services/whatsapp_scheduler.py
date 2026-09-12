import asyncio
import logging
from datetime import date, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from services.db import get_supabase

from services.chores import chore_due_today
from services.llm_client import get_completion
from services.whatsapp_client import send_text

logger = logging.getLogger(__name__)

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
    return _supabase


async def _send_weekly_summary(group_jid: str, household_id: str, cutoff_mode: str):
    from api.routers.messages import build_last7days_total, build_week_total
    try:
        if cutoff_mode == "last7days":
            text = await build_last7days_total(household_id)
        else:
            text = await build_week_total(household_id)
        # Only prompt for confirmation if there are actually receipts to pay
        if not text.startswith("No receipts"):
            text += "\n\n💳 Reply *paid* once reimbursed to close this cycle."
        await send_text(group_jid, text, household_id)
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
                await send_text(group_jid, msg, policy.get("household_id"))
        except Exception as e:
            logger.error(f"[scheduler] Renewal check failed for {target_date}: {e}")


def _compose_daily_tasks_message(chores: list[dict]) -> str:
    lines = [c["title"] + (f" — {c['notes']}" if c.get("notes") else "") for c in chores]
    try:
        prompt = "Today's pending chores:\n" + "\n".join(f"- {l}" for l in lines)
        composed = get_completion(
            prompt,
            system=(
                "You are Homly's household assistant messaging a family's WhatsApp group each "
                "morning to brief the helper on today's tasks. Be warm, concise (under 80 words), "
                "and list the tasks clearly with a short friendly opener and closer."
            ),
        )
        return composed.strip()
    except Exception as e:
        logger.error(f"[scheduler] LLM compose failed, falling back to plain list: {e}")
        return "🧹 *Today's Tasks*\n\n" + "\n".join(f"- {l}" for l in lines)


async def _send_daily_tasks():
    logger.info("[scheduler] Checking daily household tasks...")
    today = date.today()
    try:
        chores = (_db().table("chores").select("*").eq("active", True).execute()).data or []
    except Exception as e:
        logger.error(f"[scheduler] Failed to load chores: {e}")
        return

    by_household: dict[str, list] = {}
    for c in chores:
        if chore_due_today(c, today):
            by_household.setdefault(c["household_id"], []).append(c)

    for household_id, due_chores in by_household.items():
        try:
            chore_ids = [c["id"] for c in due_chores]
            logs = (
                _db().table("chore_logs").select("chore_id")
                .eq("household_id", household_id).eq("log_date", today.isoformat())
                .in_("chore_id", chore_ids)
                .execute()
            ).data or []
            logged_ids = {l["chore_id"] for l in logs}
            pending = [c for c in due_chores if c["id"] not in logged_ids]
            if not pending:
                continue

            settings_res = (
                _db().table("settings").select("group_jid")
                .eq("household_id", household_id).limit(1).execute()
            )
            group_jid = settings_res.data[0].get("group_jid") if settings_res.data else None
            if not group_jid:
                continue

            profile_res = (
                _db().table("helper_profile").select("off_days")
                .eq("household_id", household_id).limit(1).execute()
            )
            off_days = (profile_res.data[0].get("off_days") or []) if profile_res.data else []
            if today.weekday() in off_days:
                continue

            msg = _compose_daily_tasks_message(pending)
            await send_text(group_jid, msg, household_id)
            logger.info(f"[scheduler] Daily tasks sent to {group_jid}")
        except Exception as e:
            logger.error(f"[scheduler] Daily tasks failed for household {household_id}: {e}")


async def _run_proactive_checks():
    """Run agents/proactive_agent.py's ReAct check once per household with a connected group."""
    logger.info("[scheduler] Running proactive household checks...")
    from agents.proactive_agent import run_proactive_check

    try:
        res = _db().table("settings").select(
            "household_id, group_jid, bot_proactive_enabled"
        ).execute()
        settings_list = res.data or []
    except Exception as e:
        logger.error(f"[scheduler] Failed to load households for proactive check: {e}")
        return

    for s in settings_list:
        household_id = s.get("household_id")
        group_jid = s.get("group_jid")
        if not household_id or not group_jid:
            continue
        # None = settings row predates 034_bot_personality; unprompted check-ins
        # were on for everyone before the switch existed, so keep them on.
        if s.get("bot_proactive_enabled") is False:
            continue
        try:
            await asyncio.to_thread(run_proactive_check, household_id, group_jid)
        except Exception as e:
            logger.error(f"[scheduler] Proactive check failed for household {household_id}: {e}")


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
        _send_daily_tasks,
        CronTrigger(hour=7, minute=0, timezone="Asia/Singapore"),
        id="daily_tasks",
        replace_existing=True,
    )

    scheduler.add_job(
        _run_proactive_checks,
        CronTrigger(hour=8, minute=0, timezone="Asia/Singapore"),
        id="proactive_checks",
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
