import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph
from supabase import create_client

from agents.base_agent import AgentResult
from agents.orchestrator.registry import AGENT_BY_TOOL_NAME, AGENTS
from agents.orchestrator.state import SupervisorState
from services.llm.factory import get_chat_model

logger = logging.getLogger(__name__)

_ROUTER_SYSTEM = (
    "You are a household assistant router. Given a user's query, decide which specialist "
    "agents to call. For compound queries that span multiple domains, call multiple agents. "
    "Always extract the most specific intent and parameters you can infer from the query."
)

_SYNTH_SYSTEM = (
    "You are a helpful household assistant. Synthesise the provided data into a clear, "
    "conversational answer. Use SGD currency. Be specific with numbers. 2-4 sentences max."
)

_TOOLS = [a.as_tool() for a in AGENTS]

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


def supervisor_node(state: SupervisorState) -> dict:
    model = get_chat_model().bind_tools(_TOOLS)
    messages = (
        [SystemMessage(content=_ROUTER_SYSTEM)]
        + _to_lc_messages(state.get("context") or [])
        + [HumanMessage(content=state["query"])]
    )
    response = model.invoke(messages)
    return {"pending_tool_calls": response.tool_calls or []}


def dispatch_tools_node(state: SupervisorState) -> dict:
    household_id = state["household_id"]
    calls = []
    for call in state.get("pending_tool_calls") or []:
        agent = AGENT_BY_TOOL_NAME.get(call["name"])
        if not agent:
            logger.warning(f"[orchestrator] unknown agent tool: {call['name']}")
            continue
        args = call.get("args") or {}
        calls.append((call["name"], agent, args.get("intent", ""), args.get("params", {})))

    results: list[AgentResult] = []
    if calls:
        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            futures = {
                pool.submit(agent.handle, intent, params, household_id): name
                for name, agent, intent, params in calls
            }
            for future in as_completed(futures):
                try:
                    results.append(future.result())
                except Exception as e:
                    logger.error(f"[orchestrator] agent {futures[future]} raised: {e}")

    return {
        "agent_results": results,
        "agents_called": [name for name, _, _, _ in calls],
    }


def finalize_node(state: SupervisorState) -> dict:
    results = state.get("agent_results") or []
    household_id = state["household_id"]
    agents_called = state.get("agents_called") or []

    if not results:
        _log_query(household_id, state["query"], agents_called, False)
        return {
            "response": (
                "I'm not sure how to answer that. Try asking about your grocery spending, "
                "insurance policies, or expense summaries."
            )
        }

    handled = [r for r in results if r.handled]
    if len(handled) == 1:
        response = handled[0].natural_language
    elif handled:
        summaries = "\n".join(f"[{r.agent}/{r.intent}]: {r.natural_language}" for r in handled)
        ai = get_chat_model().invoke([
            SystemMessage(content=_SYNTH_SYSTEM),
            HumanMessage(content=f'User asked: "{state["query"]}"\n\nAgent findings:\n{summaries}'),
        ])
        response = ai.content
    else:
        response = "I found relevant data but wasn't able to produce an answer."

    _log_query(household_id, state["query"], agents_called, bool(handled))
    return {"response": response}


def _route_after_supervisor(state: SupervisorState) -> str:
    return "dispatch" if state.get("pending_tool_calls") else "finalize"


# ── Graph ─────────────────────────────────────────────────────────────────────

_builder = StateGraph(SupervisorState)
_builder.add_node("supervisor", supervisor_node)
_builder.add_node("dispatch_tools", dispatch_tools_node)
_builder.add_node("finalize", finalize_node)

_builder.set_entry_point("supervisor")
_builder.add_conditional_edges("supervisor", _route_after_supervisor, {
    "dispatch": "dispatch_tools",
    "finalize": "finalize",
})
_builder.add_edge("dispatch_tools", "finalize")
_builder.add_edge("finalize", END)

_graph = _builder.compile()


@dataclass
class QueryResponse:
    response: str
    sources: list[dict]
    handled: bool


def run_query(query: str, household_id: str, context: list[dict] | None = None) -> QueryResponse:
    result = _graph.invoke({
        "household_id": household_id,
        "query": query,
        "context": context or [],
        "pending_tool_calls": [],
        "agents_called": [],
        "agent_results": [],
        "response": None,
    })

    results = result.get("agent_results") or []
    sources = [
        {"agent": r.agent, "intent": r.intent, "handled": r.handled, "data": r.data}
        for r in results
    ]
    return QueryResponse(
        response=result.get("response") or "I couldn't process that query.",
        sources=sources,
        handled=any(r.handled for r in results),
    )
