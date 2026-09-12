import logging
from datetime import date

from services.db import get_supabase

from agents.base_agent import AgentManifest, AgentResult, BaseQueryAgent
from services.chores import chore_due_today
from services.shopping_list import add_auto_item

logger = logging.getLogger(__name__)

MANIFEST = AgentManifest(
    name="tasks",
    tool_name="query_tasks",
    description=(
        "Manages household chores and the domestic helper's schedule. Handles assigning "
        "chores, listing today's tasks, marking chores done or skipped, adding items to the "
        "shopping list, and requesting leave/time off for the helper."
    ),
    intents=[
        {"name": "list_today_tasks",  "description": "List today's pending/done chores"},
        {"name": "assign_task",       "description": "Create a new one-off or recurring chore"},
        {"name": "mark_task_done",    "description": "Mark a chore done for today"},
        {"name": "mark_task_skipped", "description": "Mark a chore skipped for today"},
        {"name": "add_shopping_item", "description": "Add an item to the household shopping list"},
        {"name": "request_leave",     "description": "Request time off / a leave day for the helper"},
    ],
    params_schema={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Chore title, for assign_task/mark_task_done/mark_task_skipped"},
            "recurrence": {"type": "string", "description": "once, daily, or weekly — for assign_task"},
            "days_of_week": {
                "type": "array", "items": {"type": "integer"},
                "description": "For weekly recurrence: 0=Monday..6=Sunday",
            },
            "due_date": {"type": "string", "description": "YYYY-MM-DD, for a one-off assign_task"},
            "item_name": {"type": "string", "description": "Item name for add_shopping_item"},
            "start_date": {"type": "string", "description": "YYYY-MM-DD, for request_leave"},
            "end_date": {"type": "string", "description": "YYYY-MM-DD, for request_leave"},
            "reason": {"type": "string", "description": "Optional reason for request_leave"},
        },
    },
    examples=["what chores are due today?", "assign vacuuming to the helper every Monday"],
)


class TasksQueryAgent(BaseQueryAgent):
    def __init__(self):
        self._supabase = None

    @property
    def manifest(self) -> AgentManifest:
        return MANIFEST

    def _db(self):
        if self._supabase is None:
            self._supabase = get_supabase()
        return self._supabase

    def handle(self, intent: str, params: dict, household_id: str,
               sender_name: str | None = None, sender_phone: str | None = None) -> AgentResult:
        try:
            if intent == "list_today_tasks":
                return self._list_today(household_id)
            if intent == "assign_task":
                return self._assign_task(params, household_id)
            if intent == "mark_task_done":
                return self._mark_task(params, household_id, "done", sender_name, sender_phone)
            if intent == "mark_task_skipped":
                return self._mark_task(params, household_id, "skipped", sender_name, sender_phone)
            if intent == "add_shopping_item":
                return self._add_shopping_item(params, household_id)
            if intent == "request_leave":
                return self._request_leave(params, household_id, sender_name, sender_phone)
        except Exception as e:
            logger.exception("Tasks agent failed to handle intent=%s household_id=%s", intent, household_id)
            return AgentResult(
                agent="tasks", handled=False, intent=intent, data={"error": str(e)},
                natural_language=f"Sorry, I couldn't do that: {e}",
            )
        return AgentResult(
            agent="tasks", handled=False, intent=intent, data={}, natural_language="Unknown intent."
        )

    def _list_today(self, household_id: str) -> AgentResult:
        today = date.today()
        chores = (
            self._db().table("chores").select("*")
            .eq("household_id", household_id).eq("active", True)
            .execute()
        ).data or []
        due = [c for c in chores if chore_due_today(c, today)]
        if not due:
            return AgentResult(agent="tasks", handled=True, intent="list_today_tasks", data={"tasks": []},
                                natural_language="No chores are scheduled for today.")

        chore_ids = [c["id"] for c in due]
        logs = (
            self._db().table("chore_logs").select("chore_id, status")
            .eq("household_id", household_id).eq("log_date", today.isoformat())
            .in_("chore_id", chore_ids)
            .execute()
        ).data or []
        done_ids = {l["chore_id"] for l in logs if l["status"] == "done"}
        skipped_ids = {l["chore_id"] for l in logs if l["status"] == "skipped"}

        pending = [c["title"] for c in due if c["id"] not in done_ids and c["id"] not in skipped_ids]
        done = [c["title"] for c in due if c["id"] in done_ids]

        parts = []
        if pending:
            parts.append("Still to do: " + ", ".join(pending))
        if done:
            parts.append("Already done: " + ", ".join(done))
        return AgentResult(agent="tasks", handled=True, intent="list_today_tasks",
                            data={"tasks": due, "pending": pending, "done": done},
                            natural_language=". ".join(parts) if parts else "Everything for today is done!")

    def _assign_task(self, params: dict, household_id: str) -> AgentResult:
        title = (params.get("title") or "").strip()
        if not title:
            return AgentResult(agent="tasks", handled=False, intent="assign_task", data={},
                                natural_language="Please specify what the task is.")
        recurrence = params.get("recurrence", "once")
        if recurrence not in ("once", "daily", "weekly"):
            recurrence = "once"
        row = {
            "household_id": household_id,
            "title": title,
            "recurrence": recurrence,
            "days_of_week": params.get("days_of_week"),
            "due_date": params.get("due_date"),
            "source": "whatsapp",
        }
        self._db().table("chores").insert(row).execute()
        return AgentResult(agent="tasks", handled=True, intent="assign_task",
                            data={"title": title, "recurrence": recurrence},
                            natural_language=f"Added *{title}* as a {recurrence} task.")

    def _find_chore(self, title: str, household_id: str) -> dict | None:
        res = (
            self._db().table("chores").select("*")
            .eq("household_id", household_id).eq("active", True)
            .ilike("title", f"%{title}%")
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None

    def _mark_task(self, params: dict, household_id: str, status: str,
                    sender_name: str | None, sender_phone: str | None) -> AgentResult:
        title = (params.get("title") or "").strip()
        if not title:
            return AgentResult(agent="tasks", handled=False, intent=f"mark_task_{status}", data={},
                                natural_language="Please specify which task.")
        chore = self._find_chore(title, household_id)
        if not chore:
            return AgentResult(agent="tasks", handled=True, intent=f"mark_task_{status}",
                                data={"found": False},
                                natural_language=f"I couldn't find a task matching \"{title}\".")

        row = {
            "chore_id": chore["id"],
            "household_id": household_id,
            "log_date": date.today().isoformat(),
            "status": status,
            "completed_by_name": sender_name,
            "completed_by_phone": sender_phone,
            "source": "whatsapp",
        }
        self._db().table("chore_logs").upsert(row, on_conflict="chore_id,log_date").execute()
        verb = "done" if status == "done" else "skipped"
        return AgentResult(agent="tasks", handled=True, intent=f"mark_task_{status}",
                            data={"chore_id": chore["id"], "title": chore["title"]},
                            natural_language=f"Marked *{chore['title']}* as {verb} for today.")

    def _add_shopping_item(self, params: dict, household_id: str) -> AgentResult:
        name = (params.get("item_name") or "").strip()
        if not name:
            return AgentResult(agent="tasks", handled=False, intent="add_shopping_item", data={},
                                natural_language="Please specify what to add to the shopping list.")
        ok = add_auto_item(self._db(), household_id, name, added_by="helper")
        if not ok:
            return AgentResult(agent="tasks", handled=False, intent="add_shopping_item", data={},
                                natural_language=f"Sorry, couldn't add *{name}* to the shopping list.")
        return AgentResult(agent="tasks", handled=True, intent="add_shopping_item",
                            data={"item_name": name},
                            natural_language=f"Added *{name}* to the shopping list.")

    def _request_leave(self, params: dict, household_id: str,
                        sender_name: str | None, sender_phone: str | None) -> AgentResult:
        start_date = params.get("start_date")
        end_date = params.get("end_date") or start_date
        if not start_date:
            return AgentResult(agent="tasks", handled=False, intent="request_leave", data={},
                                natural_language="Please specify a date for the leave request.")
        row = {
            "household_id": household_id,
            "start_date": start_date,
            "end_date": end_date,
            "reason": params.get("reason"),
            "requested_by_name": sender_name,
            "requested_by_phone": sender_phone,
            "source": "whatsapp",
        }
        self._db().table("helper_leave_requests").insert(row).execute()
        return AgentResult(agent="tasks", handled=True, intent="request_leave",
                            data={"start_date": start_date, "end_date": end_date},
                            natural_language=f"Leave request for {start_date} to {end_date} has been submitted for approval.")
