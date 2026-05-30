import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.homly_graph import graph

result = graph.invoke({
    "household_id": "test-household",
    "group_jid": None,
    "query": "how much did we spend?",
    "image_bytes": None,
    "image_mime": None,
    "agent_results": [],
    "context": [],
    "response": None,
    "error": None,
})

print("message_type:", result.get("message_type"))
print("response:", result.get("response"))
print("agent_results:", result.get("agent_results"))

print(graph.get_graph().draw_mermaid())
