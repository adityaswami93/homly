import json
import logging
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from services.supabase_client import get_supabase

from api.routers.households import require_admin
from services.chores import chore_due_today
from services.llm_client import get_completion

logger = logging.getLogger(__name__)
router = APIRouter()

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
    return _supabase


def _resolve_household(request: Request, household_id: Optional[str] = None) -> str:
    resolved = request.state.user.get("household_id")
    if not resolved and request.state.user.get("is_service_key"):
        resolved = household_id
    if not resolved:
        raise HTTPException(status_code=403, detail="No household found")
    return resolved


# ── Chores ────────────────────────────────────────────────────────────────

@router.get("/tasks")
def list_tasks(request: Request):
    household_id = _resolve_household(request)
    today = date.today()

    chores = (
        _db().table("chores")
        .select("*")
        .eq("household_id", household_id)
        .eq("active", True)
        .order("created_at")
        .execute()
    ).data or []

    due_today = [c for c in chores if chore_due_today(c, today)]
    chore_ids = [c["id"] for c in due_today]
    logs_today = {}
    if chore_ids:
        logs = (
            _db().table("chore_logs")
            .select("chore_id, status")
            .eq("household_id", household_id)
            .eq("log_date", today.isoformat())
            .in_("chore_id", chore_ids)
            .execute()
        ).data or []
        logs_today = {l["chore_id"]: l["status"] for l in logs}

    for c in chores:
        c["status_today"] = logs_today.get(c["id"], "pending") if c["id"] in chore_ids else None
        c["due_today"] = c["id"] in chore_ids

    return chores


@router.post("/tasks")
def create_task(request: Request, body: dict):
    household_id = _resolve_household(request)
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    recurrence = body.get("recurrence", "once")
    if recurrence not in ("once", "daily", "weekly"):
        raise HTTPException(status_code=400, detail="recurrence must be once, daily, or weekly")

    row = {
        "household_id": household_id,
        "title": title,
        "notes": body.get("notes"),
        "recurrence": recurrence,
        "days_of_week": body.get("days_of_week"),
        "due_date": body.get("due_date"),
        "created_by": request.state.user.get("sub"),
        "source": body.get("source", "dashboard"),
    }
    res = _db().table("chores").insert(row).execute()
    return res.data[0]


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, request: Request, body: dict):
    household_id = _resolve_household(request)
    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("title", "notes", "recurrence", "days_of_week", "due_date", "active"):
        if field in body:
            updates[field] = body[field]

    res = (
        _db().table("chores")
        .update(updates)
        .eq("id", task_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Task not found")
    return res.data[0]


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, request: Request):
    household_id = _resolve_household(request)
    res = (
        _db().table("chores")
        .update({"active": False, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", task_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "ok"}


@router.post("/tasks/{task_id}/complete")
def complete_task(task_id: str, request: Request, body: Optional[dict] = None):
    household_id = _resolve_household(request)
    body = body or {}

    chore = (
        _db().table("chores").select("id")
        .eq("id", task_id).eq("household_id", household_id)
        .execute()
    )
    if not chore.data:
        raise HTTPException(status_code=404, detail="Task not found")

    row = {
        "chore_id": task_id,
        "household_id": household_id,
        "log_date": body.get("log_date", date.today().isoformat()),
        "status": body.get("status", "done"),
        "completed_by_name": body.get("completed_by_name"),
        "completed_by_phone": body.get("completed_by_phone"),
        "source": body.get("source", "dashboard"),
    }
    res = (
        _db().table("chore_logs")
        .upsert(row, on_conflict="chore_id,log_date")
        .execute()
    )
    return res.data[0]


@router.get("/tasks/history")
def task_history(
    request: Request,
    from_date: Optional[str] = Query(default=None, alias="from"),
    to_date: Optional[str] = Query(default=None, alias="to"),
):
    household_id = _resolve_household(request)
    q = (
        _db().table("chore_logs")
        .select("*, chores(title, notes)")
        .eq("household_id", household_id)
        .order("log_date", desc=True)
    )
    if from_date:
        q = q.gte("log_date", from_date)
    if to_date:
        q = q.lte("log_date", to_date)
    return q.execute().data or []


# ── Leave requests ───────────────────────────────────────────────────────

@router.get("/tasks/leave-requests")
def list_leave_requests(request: Request, status: Optional[str] = Query(default=None)):
    household_id = _resolve_household(request)
    q = (
        _db().table("helper_leave_requests")
        .select("*")
        .eq("household_id", household_id)
        .order("start_date", desc=True)
    )
    if status:
        q = q.eq("status", status)
    return q.execute().data or []


@router.post("/tasks/leave-requests")
def create_leave_request(request: Request, body: dict):
    household_id = _resolve_household(request)
    start_date = body.get("start_date")
    end_date = body.get("end_date")
    if not start_date or not end_date:
        raise HTTPException(status_code=400, detail="start_date and end_date are required")

    row = {
        "household_id": household_id,
        "start_date": start_date,
        "end_date": end_date,
        "reason": body.get("reason"),
        "requested_by_name": body.get("requested_by_name"),
        "requested_by_phone": body.get("requested_by_phone"),
        "source": body.get("source", "dashboard"),
    }
    res = _db().table("helper_leave_requests").insert(row).execute()
    return res.data[0]


@router.patch("/tasks/leave-requests/{request_id}")
def decide_leave_request(request_id: str, request: Request, body: dict):
    household_id = _resolve_household(request)
    require_admin(request)

    status = body.get("status")
    if status not in ("approved", "denied"):
        raise HTTPException(status_code=400, detail="status must be approved or denied")

    res = (
        _db().table("helper_leave_requests")
        .update({
            "status": status,
            "decided_by": request.state.user.get("sub"),
            "decided_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", request_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Leave request not found")
    return res.data[0]


# ── Helper profile & onboarding ─────────────────────────────────────────

@router.get("/tasks/helper-profile")
def get_helper_profile(request: Request):
    household_id = _resolve_household(request)
    res = (
        _db().table("helper_profile").select("*")
        .eq("household_id", household_id)
        .execute()
    )
    return res.data[0] if res.data else None


_ONBOARDING_SYSTEM_PROMPT = (
    "You help set up a household chore schedule for a domestic helper. Given a free-text "
    "description of the helper's typical week, propose a starter set of chores and the "
    "helper's recurring weekly off day(s).\n\n"
    "Return ONLY a JSON object — no markdown, no explanation, no backticks. Exactly this schema:\n"
    "{\n"
    '  "chores": [{"title": string, "recurrence": "once"|"daily"|"weekly", '
    '"days_of_week": [int] or null, "due_date": "YYYY-MM-DD" or null}],\n'
    '  "off_days": [int]\n'
    "}\n"
    "days_of_week / off_days use 0=Monday .. 6=Sunday. Keep chore titles short and specific "
    "(e.g. \"Mop living room\", not \"Cleaning\"). Propose 4-10 chores based on what's described."
)


def _parse_llm_json(raw: str) -> dict:
    clean = raw.strip()
    if clean.startswith("```"):
        parts = clean.split("```")
        clean = parts[1]
        if clean.startswith("json"):
            clean = clean[4:]
        clean = clean.strip()
    return json.loads(clean)


@router.post("/tasks/onboarding/suggest")
def suggest_onboarding(request: Request, body: dict):
    _resolve_household(request)
    description = (body.get("description") or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="description is required")

    helper_name = body.get("helper_name")
    prompt = f"Helper name: {helper_name or 'unknown'}\n\nDescription of their typical week:\n{description}"

    try:
        raw = get_completion(prompt, system=_ONBOARDING_SYSTEM_PROMPT)
        result = _parse_llm_json(raw)
        result.setdefault("chores", [])
        result.setdefault("off_days", [])
        return result
    except Exception as e:
        logger.error(f"[tasks/onboarding/suggest] LLM suggestion failed: {e}")
        return {"chores": [], "off_days": [], "error": "Couldn't generate suggestions — add chores manually."}


@router.post("/tasks/onboarding/confirm")
def confirm_onboarding(request: Request, body: dict):
    household_id = _resolve_household(request)

    chores = body.get("chores") or []
    off_days = body.get("off_days") or []

    inserted = []
    for c in chores:
        title = (c.get("title") or "").strip()
        if not title:
            continue
        recurrence = c.get("recurrence", "once")
        if recurrence not in ("once", "daily", "weekly"):
            recurrence = "once"
        row = {
            "household_id": household_id,
            "title": title,
            "notes": c.get("notes"),
            "recurrence": recurrence,
            "days_of_week": c.get("days_of_week"),
            "due_date": c.get("due_date"),
            "created_by": request.state.user.get("sub"),
            "source": "dashboard",
        }
        inserted.append(row)
    if inserted:
        _db().table("chores").insert(inserted).execute()

    profile_row = {
        "household_id": household_id,
        "has_helper": body.get("has_helper", True),
        "helper_name": body.get("helper_name"),
        "duties_description": body.get("duties_description"),
        "off_days": off_days,
        "onboarded_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _db().table("helper_profile").upsert(profile_row, on_conflict="household_id").execute()

    return {"status": "ok", "chores_created": len(inserted)}
