import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END, StateGraph
from supabase import create_client

from agents.base_agent import AgentResult
from agents.orchestrator.registry import AGENT_BY_TOOL_NAME, AGENTS
from agents.orchestrator.state import SupervisorState
from services.llm.factory import get_chat_model

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are a household assistant with tools for expenses, insurance, pantry, and "
    "savings. Call a tool, look at what it returns, and call another tool if you need "
    "more information before answering — chain lookups when a question depends on more "
    "than one domain (e.g. checking savings against an upcoming insurance renewal). Call "
    "multiple tools in the same turn only when they don't depend on each other's results. "
    "When you have enough information, answer the user directly in plain, conversational "
    "language — SGD currency, specific numbers, 2-4 sentences unless they asked for a list."
)

_TOOLS = [a.as_tool() for a in AGENTS]
_MAX_ITERATIONS = 6

_ROLE_TO_MESSAGE = {"user": HumanMessage, "assistant": AIMessage, "system": SystemMessage}

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


def _log_query(household_id: str, query: str, agents_called: list[str], handled: bool) -> None:
    try:
        _db().table("query_logs").insert({
            "household_id": household_id,
            "query": query,
            "agents_called": agents_called,
            "handled": handled,
        }).execute()
    except Exception as e:
        logger.warning(f"[orchestrator] query log failed: {e}")


def _to_lc_messages(context: list[dict]) -> list:
    return [_ROLE_TO_MESSAGE.get(m.get("role"), HumanMessage)(content=m.get("content", "")) for m in context]


# ── Nodes ─────────────────────────────────────────────────────────────────────


def agent_node(state: SupervisorState) -> dict:
    model = get_chat_model().bind_tools(_TOOLS)
    response = model.invoke(state["messages"])
    return {
        "messages": [response],
        "iterations": state.get("iterations", 0) + 1,
    }


def tools_node(state: SupervisorState) -> dict:
    household_id = state["household_id"]
    last_message = state["messages"][-1]

    calls = []
    for call in last_message.tool_calls:
        agent = AGENT_BY_TOOL_NAME.get(call["name"])
        if not agent:
            logger.warning(f"[orchestrator] unknown agent tool: {call['name']}")
            continue
        args = call.get("args") or {}
        calls.append((call["id"], call["name"], agent, args.get("intent", ""), args.get("params", {})))

    tool_messages: list[ToolMessage] = []
    results: list[AgentResult] = []
    if calls:
        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            futures = {
                pool.submit(agent.handle, intent, params, household_id): (call_id, name)
                for call_id, name, agent, intent, params in calls
            }
            for future in as_completed(futures):
                call_id, name = futures[future]
                try:
                    result = future.result()
                except Exception as e:
                    logger.error(f"[orchestrator] agent {name} raised: {e}")
                    tool_messages.append(ToolMessage(content=f"Error: {e}", tool_call_id=call_id))
                    continue
                results.append(result)
                tool_messages.append(ToolMessage(content=result.natural_language, tool_call_id=call_id))

    return {
        "messages": tool_messages,
        "agent_results": results,
        "agents_called": [name for _, name, _, _, _ in calls],
    }


def force_finalize_node(state: SupervisorState) -> dict:
    # No tools bound here — the model can't loop again, it must answer in text.
    model = get_chat_model()
    nudge = SystemMessage(
        content="You've used all available tool calls for this turn. Answer the user "
        "now with what you've found so far, and say plainly if something is incomplete."
    )
    response = model.invoke(state["messages"] + [nudge])
    return {"messages": [response]}


def _route_after_agent(state: SupervisorState) -> str:
    last_message = state["messages"][-1]
    if not getattr(last_message, "tool_calls", None):
        return "end"
    if state.get("iterations", 0) >= _MAX_ITERATIONS:
        return "force_finalize"
    return "tools"


# ── Graph ─────────────────────────────────────────────────────────────────────

_builder = StateGraph(SupervisorState)
_builder.add_node("agent", agent_node)
_builder.add_node("tools", tools_node)
_builder.add_node("force_finalize", force_finalize_node)

_builder.set_entry_point("agent")
_builder.add_conditional_edges("agent", _route_after_agent, {
    "tools": "tools",
    "force_finalize": "force_finalize",
    "end": END,
})
_builder.add_edge("tools", "agent")
_builder.add_edge("force_finalize", END)

_graph = _builder.compile()


@dataclass
class QueryResponse:
    response: str
    sources: list[dict]
    handled: bool


def run_query(query: str, household_id: str, context: list[dict] | None = None) -> QueryResponse:
    messages = (
        [SystemMessage(content=_SYSTEM_PROMPT)]
        + _to_lc_messages(context or [])
        + [HumanMessage(content=query)]
    )

    result = _graph.invoke(
        {
            "household_id": household_id,
            "messages": messages,
            "agents_called": [],
            "agent_results": [],
            "iterations": 0,
        },
        config={"recursion_limit": 50},
    )

    results = result.get("agent_results") or []
    sources = [
        {"agent": r.agent, "intent": r.intent, "handled": r.handled, "data": r.data}
        for r in results
    ]
    agents_called = result.get("agents_called") or []
    handled = any(r.handled for r in results)

    final_message = result["messages"][-1]
    response_text = final_message.content if isinstance(final_message.content, str) else str(final_message.content)

    _log_query(household_id, query, agents_called, handled)

    return QueryResponse(
        response=response_text or "I couldn't process that query.",
        sources=sources,
        handled=handled,
    )
