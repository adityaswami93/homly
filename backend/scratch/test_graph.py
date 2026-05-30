"""
Standalone smoke-test for homly_graph.py.  No pytest — just print statements.
Run with:  python backend/scratch/test_graph.py
"""
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.homly_graph import graph, get_graph, _classify_text

HOUSEHOLD = "test-household"

# ── 1. Text classification (keyword, no LLM) ─────────────────────────────────

cases = [
    ("how much did we spend on groceries?",  "text_query"),
    ("what is our total this week",           "text_query"),
    ("show me last week's expenses",          "text_query"),
    ("added milk and eggs",                   "pantry_command"),
    ("running low on olive oil",              "pantry_command"),
    ("bought 2 bags of rice",                 "pantry_command"),
    ("out of dishwashing liquid",             "pantry_command"),
    ("hello there",                           "unknown"),
]

print("── Text classification ──────────────────────────────────")
all_passed = True
for text, expected in cases:
    got = _classify_text(text)
    status = "✅" if got == expected else "❌"
    if got != expected:
        all_passed = False
    print(f"  {status}  [{expected:18s}]  '{text}'")
print()

# ── 2. Graph invocation — text_query route ───────────────────────────────────

print("── Graph invoke: text_query ─────────────────────────────")
# query_node calls run_query which needs Supabase — we test routing only by
# patching query_node so the test is self-contained.
import agents.homly_graph as _graph_mod
_orig_query_node = _graph_mod.query_node

def _mock_query_node(state):
    return {"agent_results": [{"agent": "query", "data": {
        "response": "You spent SGD 123 this week.",
        "sources": [],
        "handled": True,
    }}]}

_graph_mod.query_node = _mock_query_node

# Re-compile with the mocked node (new builder needed after patching)
from langgraph.graph import StateGraph, END
from agents.homly_graph import HomlyState, classify_node, recipe_node, receipt_node, pantry_node, synthesise_node, route_by_type

b = StateGraph(HomlyState)
b.add_node("classify", classify_node)
b.add_node("receipt", receipt_node)
b.add_node("recipe", recipe_node)
b.add_node("query", _mock_query_node)
b.add_node("pantry", pantry_node)
b.add_node("synthesise", synthesise_node)
b.set_entry_point("classify")
b.add_conditional_edges("classify", route_by_type, {
    "receipt": "receipt",
    "recipe": "recipe",
    "text_query": "query",
    "pantry_command": "pantry",
    "unknown": END,
})
b.add_edge("receipt", "synthesise")
b.add_edge("recipe", "synthesise")
b.add_edge("query", "synthesise")
b.add_edge("pantry", "synthesise")
b.add_edge("synthesise", END)
test_graph = b.compile()

result = test_graph.invoke({
    "household_id": HOUSEHOLD,
    "group_jid": None,
    "query": "how much did we spend?",
    "image_bytes": None,
    "image_mime": None,
    "agent_results": [],
    "context": [],
    "response": None,
    "error": None,
})
assert result["message_type"] == "text_query", f"Expected text_query, got {result['message_type']}"
assert result["response"] == "You spent SGD 123 this week.", f"Unexpected response: {result['response']}"
print(f"  ✅  message_type: {result['message_type']}")
print(f"  ✅  response: {result['response']}")
print()

# ── 3. Graph invocation — pantry_command route ───────────────────────────────

print("── Graph invoke: pantry_command ─────────────────────────")
b2 = StateGraph(HomlyState)
b2.add_node("classify", classify_node)
b2.add_node("receipt", receipt_node)
b2.add_node("recipe", recipe_node)
b2.add_node("query", _mock_query_node)
b2.add_node("pantry", _mock_query_node)
b2.add_node("synthesise", synthesise_node)
b2.set_entry_point("classify")
b2.add_conditional_edges("classify", route_by_type, {
    "receipt": "receipt",
    "recipe": "recipe",
    "text_query": "query",
    "pantry_command": "pantry",
    "unknown": END,
})
b2.add_edge("receipt", "synthesise")
b2.add_edge("recipe", "synthesise")
b2.add_edge("query", "synthesise")
b2.add_edge("pantry", "synthesise")
b2.add_edge("synthesise", END)
test_graph2 = b2.compile()

result2 = test_graph2.invoke({
    "household_id": HOUSEHOLD,
    "group_jid": None,
    "query": "added milk and eggs",
    "image_bytes": None,
    "image_mime": None,
    "agent_results": [],
    "context": [],
    "response": None,
    "error": None,
})
assert result2["message_type"] == "pantry_command", f"Expected pantry_command, got {result2['message_type']}"
print(f"  ✅  message_type: {result2['message_type']}")
print()

# ── 4. Graph invocation — unknown route (no synthesise) ──────────────────────

print("── Graph invoke: unknown ────────────────────────────────")
result3 = test_graph.invoke({
    "household_id": HOUSEHOLD,
    "group_jid": None,
    "query": "hello there",
    "image_bytes": None,
    "image_mime": None,
    "agent_results": [],
    "context": [],
    "response": None,
    "error": None,
})
assert result3["message_type"] == "unknown", f"Expected unknown, got {result3['message_type']}"
assert result3.get("response") is None, f"Expected no response, got {result3.get('response')}"
print(f"  ✅  message_type: {result3['message_type']}")
print(f"  ✅  response is None")
print()

# ── 5. get_graph stateless ───────────────────────────────────────────────────

print("── get_graph(with_memory=False) ─────────────────────────")
g = get_graph(with_memory=False)
assert g is not None
print("  ✅  returns compiled graph")
print()

# ── 6. Mermaid diagram ────────────────────────────────────────────────────────

print("── Mermaid diagram ──────────────────────────────────────")
print(graph.get_graph().draw_mermaid())

# ── 7. Checkpointer test (only if SUPABASE_DB_URL is set) ────────────────────

db_url = os.getenv("SUPABASE_DB_URL")
if db_url:
    print("── get_graph(with_memory=True) ──────────────────────────")
    g_mem = get_graph(with_memory=True)
    assert g_mem is not None
    print("  ✅  PostgresSaver checkpointer initialised")
    print()
else:
    print("── Skipping checkpointer test (SUPABASE_DB_URL not set) ─")
    print()

print("All tests passed ✅")
