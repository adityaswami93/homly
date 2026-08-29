"""agents/orchestrator/react_loop.py's shared graph-wiring skeleton, exercised
with fake agent/tools nodes so no LLM call is needed. supervisor.py and
proactive_agent.py both build their real graphs on top of this — these tests
cover the routing behavior they rely on: keep looping while the model calls
tools, stop on a plain answer, and take the configured exit at the
iteration cap.
"""
from typing import TypedDict

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agents.orchestrator.react_loop import build_react_graph, make_route_after_agent


class _State(TypedDict):
    messages: list
    iterations: int


def _ai_with_tool_call() -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": "noop", "args": {}, "id": "1"}])


def _ai_text(text: str = "done") -> AIMessage:
    return AIMessage(content=text)


# ── make_route_after_agent ──────────────────────────────────────────────────


def test_routes_to_tools_when_tool_calls_present_and_under_cap():
    route = make_route_after_agent(max_iterations=3, on_exhausted="end")
    state = {"messages": [_ai_with_tool_call()], "iterations": 1}
    assert route(state) == "tools"


def test_routes_to_end_when_no_tool_calls():
    route = make_route_after_agent(max_iterations=3, on_exhausted="end")
    state = {"messages": [_ai_text()], "iterations": 1}
    assert route(state) == "end"


def test_routes_to_end_at_cap_when_on_exhausted_is_end():
    route = make_route_after_agent(max_iterations=2, on_exhausted="end")
    state = {"messages": [_ai_with_tool_call()], "iterations": 2}
    assert route(state) == "end"


def test_routes_to_force_finalize_at_cap_when_configured():
    route = make_route_after_agent(max_iterations=2, on_exhausted="force_finalize")
    state = {"messages": [_ai_with_tool_call()], "iterations": 2}
    assert route(state) == "force_finalize"


# ── build_react_graph ────────────────────────────────────────────────────────


def _make_toy_graph(on_exhausted, max_iterations, tool_replies):
    """A graph whose fake agent_node answers with a tool call `len(tool_replies)`
    times, then a plain text answer — exercising the same loop shape the real
    graphs use without any LLM call.
    """
    calls = {"n": 0}

    def agent_node(state: _State) -> dict:
        i = state.get("iterations", 0)
        msg = _ai_with_tool_call() if i < len(tool_replies) else _ai_text("final answer")
        return {"messages": [msg], "iterations": i + 1}

    def tools_node(state: _State) -> dict:
        calls["n"] += 1
        return {"messages": [ToolMessage(content="ok", tool_call_id="1")]}

    graph = build_react_graph(_State, agent_node, tools_node, max_iterations, on_exhausted=on_exhausted)
    return graph, calls


def test_end_to_end_loop_stops_on_plain_text_answer():
    graph, calls = _make_toy_graph(on_exhausted="end", max_iterations=10, tool_replies=[1, 1])
    result = graph.invoke({"messages": [HumanMessage(content="hi")], "iterations": 0})
    assert calls["n"] == 2
    assert result["messages"][-1].content == "final answer"


def test_end_to_end_loop_ends_silently_at_cap_when_on_exhausted_is_end():
    # Agent always wants to call a tool — with on_exhausted="end" the loop must
    # stop at the cap without forcing a finalize call. iterations is incremented
    # inside agent_node itself, so the cap trips on the agent call that reaches
    # it, before a matching tools_node call happens for that round.
    graph, calls = _make_toy_graph(on_exhausted="end", max_iterations=2, tool_replies=[1, 1, 1, 1, 1])
    result = graph.invoke({"messages": [HumanMessage(content="hi")], "iterations": 0})
    assert calls["n"] == 1
    last = result["messages"][-1]
    assert getattr(last, "tool_calls", None)  # ended mid tool-call, not forced to text


def test_end_to_end_loop_force_finalizes_at_cap(monkeypatch):
    # force_finalize_node calls get_chat_model() for real — stub it so this
    # stays a pure routing test.
    import agents.orchestrator.react_loop as react_loop

    class _StubModel:
        def invoke(self, messages):
            return _ai_text("forced answer")

    monkeypatch.setattr(react_loop, "get_chat_model", lambda: _StubModel())

    graph, calls = _make_toy_graph(on_exhausted="force_finalize", max_iterations=2, tool_replies=[1, 1, 1])
    result = graph.invoke({"messages": [HumanMessage(content="hi")], "iterations": 0})
    assert calls["n"] == 1
    assert result["messages"][-1].content == "forced answer"
