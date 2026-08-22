"""Proactive household monitor — the same Reason/Act/Observe loop as
agents/orchestrator/supervisor.py, run unprompted on a schedule instead of in
response to a chat message.

Reuses the domain agents already registered in agents/orchestrator/registry.py
for the "Act" step, but only their read-only intents (see _READONLY_INTENTS
below) — an agent whose tools can also write (pantry add/mark, budget set,
task assign) must not be able to mutate household data on an unattended run.
This is enforced here, not just by prompting: an intent not listed in
_READONLY_INTENTS is refused by tools_node before it ever reaches the agent.

The one new "Act" available to this loop is notify_household, which sends a
WhatsApp message — gated by services/proactive_notifications.py so the same
finding isn't re-sent every run.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from operator import add
from typing import Annotated, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages

from agents.orchestrator.registry import AGENT_BY_TOOL_NAME
from services import preferences, proactive_notifications
from services.llm.factory import get_chat_model
from services.whatsapp_client import send_text_sync

logger = logging.getLogger(__name__)

# Which intents on each registered domain agent are safe to call from an
# unattended run. None = every intent on that agent is read-only. An agent
# not listed here at all is not reachable from the proactive loop.
_READONLY_INTENTS: dict[str, set[str] | None] = {
    "query_grocery":     None,
    "query_insurance":   None,
    "query_savings":     None,
    "query_reminders":   None,
    "query_pantry":      {"list_items", "check_item"},
    "query_budgets":     {"budget_status"},
    "query_tasks":       {"list_today_tasks"},
    "query_preferences": {"list"},
}

_NOTIFY_COOLDOWN_HOURS = 24
_MAX_ITERATIONS = 8

_NOTIFY_TOOL = {
    "type": "function",
    "function": {
        "name": "notify_household",
        "description": (
            "Send a message to the household's WhatsApp group about something worth surfacing "
            "right now. Call once per distinct finding — a budget over or close to its limit, a "
            "frequently-used pantry item critically low, an unusual price spike, an overdue item. "
            "Only for something genuinely actionable or notable, never routine/expected state."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "finding_key": {
                    "type": "string",
                    "description": (
                        "Short stable identifier for this specific finding, e.g. "
                        "'budget_over:groceries:2026-08' or 'pantry_low:milk'. Reused across runs "
                        "so the same issue isn't re-notified while it's still true."
                    ),
                },
                "message": {
                    "type": "string",
                    "description": "The WhatsApp message to send — concise, plain language.",
                },
            },
            "required": ["finding_key", "message"],
        },
    },
}

_NO_ACTION_TOOL = {
    "type": "function",
    "function": {
        "name": "no_action",
        "description": "Call once you've checked what you need to and there's nothing worth surfacing right now.",
        "parameters": {"type": "object", "properties": {}},
    },
}


def _readonly_tools() -> list[dict]:
    tools = []
    for tool_name, allowed in _READONLY_INTENTS.items():
        agent = AGENT_BY_TOOL_NAME.get(tool_name)
        if not agent:
            continue
        m = agent.manifest
        intents = m.intents if allowed is None else [i for i in m.intents if i["name"] in allowed]
        if not intents:
            continue
        intent_docs = "\n".join(f"  - {i['name']}: {i['description']}" for i in intents)
        tools.append({
            "type": "function",
            "function": {
                "name": m.tool_name,
                "description": f"{m.description}\n\nAvailable intents:\n{intent_docs}",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "intent": {"type": "string", "enum": [i["name"] for i in intents]},
                        "params": m.params_schema,
                    },
                    "required": ["intent", "params"],
                },
            },
        })
    return tools


_TOOLS = _readonly_tools() + [_NOTIFY_TOOL, _NO_ACTION_TOOL]

_BASE_PROMPT = (
    "You are Homly, this household's personal assistant, checking in unprompted on a schedule — "
    "nobody has asked you anything this run. Check the household's budgets, pantry, insurance, "
    "savings, reminders, tasks, and remembered preferences (query_preferences) using the read-only "
    "tools available, and decide if anything is worth surfacing right now: a budget over or close "
    "to its limit, a frequently-used pantry item critically low, an insurance policy renewing soon, "
    "an unusual price spike, an overdue reminder or task. Weigh what you find against any "
    "preferences listed below.\n\n"
    "Call notify_household once per distinct finding, with a stable finding_key so the same issue "
    "isn't repeated every run. Write the message like you're a household member who happens to "
    "keep track of this stuff for them, not a monitoring system — warm, brief, plain language, no "
    "jargon or field labels. Be conservative — most runs should end in no_action; only notify for "
    "something a household member would actually want pinged about right now, not routine state. "
    "Call no_action when you're done checking and found nothing."
)


class ProactiveState(TypedDict):
    household_id: str
    group_jid: str
    messages: Annotated[list, add_messages]
    iterations: int
    notified: Annotated[list[str], add]


def _build_system_prompt(household_id: str) -> str:
    prompt = _BASE_PROMPT
    # Only household-wide preferences apply here — this run isn't addressed to
    # any one person, so a personal preference (sender_phone set) wouldn't mean
    # anything in a message sent to the whole group.
    prefs_text = preferences.format_for_prompt(preferences.get_preferences(household_id))
    if prefs_text:
        prompt += f"\n\nRemembered preferences:\n{prefs_text}"
    return prompt


def agent_node(state: ProactiveState) -> dict:
    model = get_chat_model().bind_tools(_TOOLS)
    response = model.invoke(state["messages"])
    return {"messages": [response], "iterations": state.get("iterations", 0) + 1}


def _handle_notify(household_id: str, group_jid: str, args: dict) -> str:
    finding_key = (args.get("finding_key") or "").strip()
    message = (args.get("message") or "").strip()
    if not finding_key or not message:
        return "Error: finding_key and message are both required."

    if proactive_notifications.was_recently_notified(household_id, finding_key, _NOTIFY_COOLDOWN_HOURS):
        return f"Skipped — '{finding_key}' was already notified within the last {_NOTIFY_COOLDOWN_HOURS}h."

    send_text_sync(group_jid, message)
    proactive_notifications.record_notified(household_id, finding_key)
    return f"Sent to the household group: {message}"


def tools_node(state: ProactiveState) -> dict:
    household_id = state["household_id"]
    group_jid = state["group_jid"]
    last_message = state["messages"][-1]

    domain_calls = []
    tool_messages: list[ToolMessage] = []
    notified: list[str] = []

    for call in last_message.tool_calls:
        name = call["name"]
        args = call.get("args") or {}

        if name == "no_action":
            tool_messages.append(ToolMessage(content="Acknowledged — nothing surfaced this run.", tool_call_id=call["id"]))
            continue

        if name == "notify_household":
            result = _handle_notify(household_id, group_jid, args)
            if result.startswith("Sent to"):
                notified.append(args.get("finding_key", ""))
            tool_messages.append(ToolMessage(content=result, tool_call_id=call["id"]))
            continue

        agent = AGENT_BY_TOOL_NAME.get(name)
        allowed = _READONLY_INTENTS.get(name)
        intent = args.get("intent", "")
        if not agent or name not in _READONLY_INTENTS or (allowed is not None and intent not in allowed):
            tool_messages.append(ToolMessage(
                content=f"Error: '{intent}' on '{name}' is not available to the proactive monitor.",
                tool_call_id=call["id"],
            ))
            continue

        domain_calls.append((call["id"], agent, intent, args.get("params", {})))

    if domain_calls:
        with ThreadPoolExecutor(max_workers=len(domain_calls)) as pool:
            futures = {
                pool.submit(agent.handle, intent, params, household_id): call_id
                for call_id, agent, intent, params in domain_calls
            }
            for future in as_completed(futures):
                call_id = futures[future]
                try:
                    result = future.result()
                    content = result.natural_language
                except Exception as e:
                    logger.error(f"[proactive_agent] tool call failed: {e}")
                    content = f"Error: {e}"
                tool_messages.append(ToolMessage(content=content, tool_call_id=call_id))

    return {"messages": tool_messages, "notified": notified}


def _route_after_agent(state: ProactiveState) -> str:
    last_message = state["messages"][-1]
    if not getattr(last_message, "tool_calls", None):
        return "end"
    if state.get("iterations", 0) >= _MAX_ITERATIONS:
        return "end"
    return "tools"


_builder = StateGraph(ProactiveState)
_builder.add_node("agent", agent_node)
_builder.add_node("tools", tools_node)
_builder.set_entry_point("agent")
_builder.add_conditional_edges("agent", _route_after_agent, {"tools": "tools", "end": END})
_builder.add_edge("tools", "agent")
_graph = _builder.compile()


@dataclass
class ProactiveResult:
    notified: list[str]


def run_proactive_check(household_id: str, group_jid: str) -> ProactiveResult:
    messages = [
        SystemMessage(content=_build_system_prompt(household_id)),
        HumanMessage(content="Run today's household check."),
    ]
    result = _graph.invoke(
        {"household_id": household_id, "group_jid": group_jid, "messages": messages, "iterations": 0, "notified": []},
        config={"recursion_limit": 30},
    )
    notified = [f for f in (result.get("notified") or []) if f]
    if notified:
        logger.info(f"[proactive_agent] household={household_id} notified={notified}")
    return ProactiveResult(notified=notified)
