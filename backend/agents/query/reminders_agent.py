import os
from datetime import datetime, timezone

from supabase import create_client

from agents.base_agent import AgentManifest, AgentResult, BaseQueryAgent

MANIFEST = AgentManifest(
    name="reminders",
    tool_name="query_reminders",
    description="Answers questions about upcoming household reminders that were set via the /remind command.",
    intents=[
        {"name": "list_reminders", "description": "List all upcoming (not yet sent) reminders"},
        {"name": "next_reminder", "description": "The single next upcoming reminder"},
    ],
    params_schema={"type": "object", "properties": {}},
)


class RemindersQueryAgent(BaseQueryAgent):
    def __init__(self):
        self._supabase = None

    @property
    def manifest(self) -> AgentManifest:
        return MANIFEST

    def _db(self):
        if self._supabase is None:
            self._supabase = create_client(
                os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY")
            )
        return self._supabase

    def handle(self, intent: str, params: dict, household_id: str,
               sender_name: str | None = None, sender_phone: str | None = None) -> AgentResult:
        try:
            if intent == "list_reminders":
                return self._list(household_id)
            if intent == "next_reminder":
                return self._list(household_id, limit=1, intent_name="next_reminder")
        except Exception as e:
            return AgentResult(
                agent="reminders",
                handled=False,
                intent=intent,
                data={"error": str(e)},
                natural_language=f"Sorry, I couldn't retrieve that data: {e}",
            )
        return AgentResult(
            agent="reminders",
            handled=False,
            intent=intent,
            data={},
            natural_language="I don't know how to handle that intent.",
        )

    def _list(self, household_id: str, limit: int | None = None, intent_name: str = "list_reminders") -> AgentResult:
        q = (
            self._db()
            .table("reminders")
            .select("message, remind_at, sender_name")
            .eq("household_id", household_id)
            .eq("sent", False)
            .gte("remind_at", datetime.now(timezone.utc).isoformat())
            .order("remind_at", desc=False)
        )
        if limit:
            q = q.limit(limit)
        res = q.execute()
        reminders = res.data or []

        if not reminders:
            return AgentResult(
                agent="reminders", handled=True, intent=intent_name,
                data={"reminders": []},
                natural_language="No upcoming reminders. Set one with /remind.",
            )

        lines = [f"{r['message']} at {r['remind_at']}" for r in reminders]
        if intent_name == "next_reminder":
            nl = f"Next reminder: {lines[0]}."
        else:
            nl = f"You have {len(reminders)} upcoming reminder(s): " + "; ".join(lines) + "."

        return AgentResult(
            agent="reminders", handled=True, intent=intent_name,
            data={"reminders": reminders}, natural_language=nl,
        )
