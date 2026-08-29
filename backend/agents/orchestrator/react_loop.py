"""Shared Reason/Act/Observe loop skeleton for LangGraph agent loops.

Both agents/orchestrator/supervisor.py (chat) and agents/proactive_agent.py
(scheduled monitor) run the same agent_node <-> tools_node shape: bind tools,
invoke the model, count iterations, and either loop back to tools or stop.
They used to implement that skeleton twice, independently — a real risk,
since a fix to iteration counting or the routing logic in one would silently
not reach the other.

What still lives in each caller, deliberately: what "stop" means (the chat
supervisor must always answer in text via force_finalize_node; the proactive
monitor is fine ending in silence — most runs should), and what tools_node
actually dispatches to (multi-agent write calls with sender attribution vs.
read-only gated calls plus notify_household/no_action). Those differ for
real reasons and forcing them into one shape would hide that difference
rather than remove duplication.
"""
from typing import Callable, Literal

from langchain_core.messages import SystemMessage
from langgraph.graph import END, StateGraph

from services.llm.factory import get_chat_model

OnExhausted = Literal["force_finalize", "end"]


def make_agent_node(tools: list[dict]) -> Callable[[dict], dict]:
    """Bind `tools` once and return a LangGraph node: invoke the model, count the iteration."""
    def agent_node(state: dict) -> dict:
        model = get_chat_model().bind_tools(tools)
        response = model.invoke(state["messages"])
        return {"messages": [response], "iterations": state.get("iterations", 0) + 1}
    return agent_node


_FINALIZE_NUDGE = SystemMessage(
    content="You've used all available tool calls for this turn. Answer the user "
    "now with what you've found so far, and say plainly if something is incomplete."
)


def force_finalize_node(state: dict) -> dict:
    """Strip tools and force a text answer — for loops that must never end silently."""
    model = get_chat_model()
    response = model.invoke(state["messages"] + [_FINALIZE_NUDGE])
    return {"messages": [response]}


def make_route_after_agent(max_iterations: int, on_exhausted: OnExhausted) -> Callable[[dict], str]:
    """Shared branch: keep looping while the model is calling tools and under the cap."""
    def route(state: dict) -> str:
        last_message = state["messages"][-1]
        if not getattr(last_message, "tool_calls", None):
            return "end"
        if state.get("iterations", 0) >= max_iterations:
            return on_exhausted
        return "tools"
    return route


def build_react_graph(
    state_type,
    agent_node: Callable[[dict], dict],
    tools_node: Callable[[dict], dict],
    max_iterations: int,
    on_exhausted: OnExhausted = "end",
):
    """Wire the standard agent <-> tools loop.

    `tools_node` and `state_type` stay caller-defined — only the skeleton
    (entry point, routing, edges, and the optional force-finalize exit) is
    shared. Pass on_exhausted="force_finalize" for a loop that must always
    produce a text answer when it hits max_iterations still mid tool-call;
    "end" (default) for a loop where silence at the cap is an acceptable
    outcome.
    """
    builder = StateGraph(state_type)
    builder.add_node("agent", agent_node)
    builder.add_node("tools", tools_node)

    route = make_route_after_agent(max_iterations, on_exhausted)
    branches = {"tools": "tools", "end": END}
    if on_exhausted == "force_finalize":
        builder.add_node("force_finalize", force_finalize_node)
        branches["force_finalize"] = "force_finalize"
        builder.add_edge("force_finalize", END)

    builder.set_entry_point("agent")
    builder.add_conditional_edges("agent", route, branches)
    builder.add_edge("tools", "agent")
    return builder.compile()
