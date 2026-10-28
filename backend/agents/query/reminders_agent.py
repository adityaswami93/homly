from datetime import datetime, time, timezone

from services.db import get_supabase
from services.household_time import household_timezone

from agents.base_agent import AgentManifest, AgentResult, BaseQueryAgent

MANIFEST = AgentManifest(
    name="reminders",
    tool_name="query_reminders",
    description=(
        "Household reminders: lists upcoming ones (set via /remind or by the assistant) and "
        "creates new ones that the bot posts to the group at the given time — e.g. a payment "
        "deadline from a letter someone sent a photo of."
    ),
    intents=[
        {"name": "list_reminders", "description": "List all upcoming (not yet sent) reminders"},
        {"name": "next_reminder", "description": "The single next upcoming reminder"},
        {"name": "create_reminder", "description": "Create a reminder posted to the group at remind_at"},
    ],
    params_schema={
        "type": "object",
        "properties": {
            "message": {"type": "string", "description": "create_reminder: what to remind the group about"},
            "remind_at": {
                "type": "string",
                "description": (
                    "create_reminder: when, as YYYY-MM-DDTHH:MM in the household's local time, or "
                    "YYYY-MM-DD for 9am that day. For a deadline, pick a time before it, not on it."
                ),
            },
        },
    },
    examples=["what reminders do I have?", "remind us on 6 Nov to pay the school excursion fee"],
)


class RemindersQueryAgent(BaseQueryAgent):
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
            if intent == "list_reminders":
                return self._list(household_id)
            if intent == "next_reminder":
                return self._list(household_id, limit=1, intent_name="next_reminder")
            if intent == "create_reminder":
                return self._create(params, household_id, sender_name, sender_phone)
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

    def _create(self, params: dict, household_id: str,
                sender_name: str | None, sender_phone: str | None) -> AgentResult:
        message = (params.get("message") or "").strip()
        tz = household_timezone(household_id)
        remind_at = parse_local_datetime(params.get("remind_at"), tz)
        if not message or remind_at is None:
            return AgentResult(
                agent="reminders", handled=False, intent="create_reminder", data={},
                natural_language="I need both what to remind you about and when.",
            )
        if remind_at <= datetime.now(timezone.utc):
            return AgentResult(
                agent="reminders", handled=False, intent="create_reminder", data={},
                natural_language="That time has already passed — when should I remind you instead?",
            )

        settings = (
            self._db().table("settings").select("group_jid")
            .eq("household_id", household_id).limit(1).execute()
        ).data or []
        group_jid = settings[0].get("group_jid") if settings else None
        if not group_jid:
            return AgentResult(
                agent="reminders", handled=False, intent="create_reminder", data={},
                natural_language="There's no WhatsApp group connected to send the reminder to.",
            )

        row = {
            "household_id": household_id,
            "group_jid": group_jid,
            # reminders.sender_jid is NOT NULL and the bot's "set by" line falls
            # back to it — a chat-created reminder has a phone, not a JID.
            "sender_jid": sender_phone or "assistant",
            "sender_name": sender_name or "Homly",
            "message": message[:1000],
            "remind_at": remind_at.isoformat(),
            "sent": False,
        }
        saved = (self._db().table("reminders").insert(row).execute()).data or []
        local = remind_at.astimezone(tz)
        when = f"{local.day} {local.strftime('%b %Y, %H:%M')}"
        return AgentResult(
            agent="reminders", handled=True, intent="create_reminder",
            data={"reminder": saved[0] if saved else row},
            natural_language=f"Reminder set for {when}: {message}",
        )


def parse_local_datetime(value, tz) -> datetime | None:
    """A model-supplied "YYYY-MM-DD[THH:MM]" read as the household's local time.

    A bare date means 9am that day — early enough to act on a same-day
    deadline. An explicit offset in the string wins over the household zone."""
    if not value or not isinstance(value, str):
        return None
    text = value.strip().replace(" ", "T", 1)
    try:
        if len(text) == 10:
            dt = datetime.combine(datetime.fromisoformat(text).date(), time(9, 0))
        else:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    return dt.astimezone(timezone.utc)
