from agents.base_agent import AgentManifest, AgentResult, BaseQueryAgent
from services import preferences

MANIFEST = AgentManifest(
    name="preferences",
    tool_name="query_preferences",
    description=(
        "Remembers standing preferences for the household or for whoever is messaging, so they "
        "don't have to repeat themselves — dietary restrictions, reminder lead times, how someone "
        "likes to be addressed, anything worth carrying into future conversations."
    ),
    intents=[
        {"name": "remember", "description": "Save or update a preference"},
        {"name": "list",     "description": "List everything currently remembered"},
        {"name": "forget",   "description": "Delete a remembered preference"},
    ],
    params_schema={
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": "Short label for the preference, e.g. 'diet', 'reminder_lead_time', 'preferred_name'",
            },
            "value": {
                "type": "string",
                "description": "The preference itself, e.g. 'vegetarian', '2 weeks before renewal'. Required for remember.",
            },
            "scope": {
                "type": "string",
                "enum": ["household", "personal"],
                "description": (
                    "'household' applies to everyone in the group; 'personal' applies only to "
                    "whoever is currently messaging. Defaults to 'personal' if omitted."
                ),
            },
        },
    },
    examples=["remember I don't eat pork", "what do you remember about me?"],
)


class PreferencesQueryAgent(BaseQueryAgent):
    @property
    def manifest(self) -> AgentManifest:
        return MANIFEST

    def handle(self, intent: str, params: dict, household_id: str,
               sender_name: str | None = None, sender_phone: str | None = None) -> AgentResult:
        try:
            if intent == "remember":
                return self._remember(params, household_id, sender_phone)
            if intent == "list":
                return self._list(household_id, sender_phone)
            if intent == "forget":
                return self._forget(params, household_id, sender_phone)
        except Exception as e:
            return AgentResult(
                agent="preferences", handled=False, intent=intent, data={"error": str(e)},
                natural_language=f"Sorry, I couldn't do that: {e}",
            )
        return AgentResult(
            agent="preferences", handled=False, intent=intent, data={},
            natural_language="I don't know how to handle that intent.",
        )

    def _scope_phone(self, params: dict, sender_phone: str | None) -> str | None:
        return None if params.get("scope") == "household" else sender_phone

    def _remember(self, params: dict, household_id: str, sender_phone: str | None) -> AgentResult:
        key = (params.get("key") or "").strip()
        value = (params.get("value") or "").strip()
        if not key or not value:
            return AgentResult(agent="preferences", handled=False, intent="remember", data={},
                               natural_language="Please specify both what to remember and its value.")

        scoped_phone = self._scope_phone(params, sender_phone)
        ok = preferences.upsert_preference(household_id, key, value, sender_phone=scoped_phone)
        scope_label = "the household" if scoped_phone is None else "you"
        nl = f"Got it — I'll remember that for {scope_label}: {key} = {value}." if ok else "Sorry, I couldn't save that."
        return AgentResult(agent="preferences", handled=ok, intent="remember",
                           data={"key": key, "value": value, "scope": "household" if scoped_phone is None else "personal"},
                           natural_language=nl)

    def _list(self, household_id: str, sender_phone: str | None) -> AgentResult:
        prefs = preferences.get_preferences(household_id)
        relevant = [p for p in prefs if p.get("sender_phone") is None or p.get("sender_phone") == sender_phone]
        if not relevant:
            return AgentResult(agent="preferences", handled=True, intent="list", data={"preferences": []},
                               natural_language="I don't have anything remembered yet.")

        lines = [f"{p['key']}: {p['value']}" + ("" if p.get("sender_phone") is None else " (personal)") for p in relevant]
        nl = "Here's what I remember: " + "; ".join(lines) + "."
        return AgentResult(agent="preferences", handled=True, intent="list", data={"preferences": relevant}, natural_language=nl)

    def _forget(self, params: dict, household_id: str, sender_phone: str | None) -> AgentResult:
        key = (params.get("key") or "").strip()
        if not key:
            return AgentResult(agent="preferences", handled=False, intent="forget", data={},
                               natural_language="Please specify which preference to forget.")

        scoped_phone = self._scope_phone(params, sender_phone)
        ok = preferences.delete_preference(household_id, key, sender_phone=scoped_phone)
        nl = f"Forgot '{key}'." if ok else f"I didn't have '{key}' remembered."
        return AgentResult(agent="preferences", handled=True, intent="forget", data={"key": key, "deleted": ok}, natural_language=nl)
