from typing import TypedDict, Optional, Annotated
from operator import add
from langgraph.graph import StateGraph, END


class HomlyState(TypedDict):
    # Identity
    household_id: str
    group_jid: Optional[str]

    # Input — one of these will be populated per invocation
    query: Optional[str]              # text message from WhatsApp or API
    image_bytes: Optional[bytes]
    image_mime: Optional[str]

    # Classification result
    message_type: Optional[str]       # "receipt" | "recipe" | "text_query" | "pantry_command" | "unknown"

    # Outputs from agents — use reducer so multiple agents can append
    agent_results: Annotated[list, add]

    # Final WhatsApp-ready response
    response: Optional[str]

    # Conversation context — last N turns for follow-up queries
    context: Optional[list]

    # Error state
    error: Optional[str]


def classify_node(state: HomlyState) -> dict:
    """Stub — will be implemented in Phase B."""
    return {"message_type": "unknown"}


def synthesise_node(state: HomlyState) -> dict:
    """Stub — will be implemented in Phase C."""
    return {"response": "stub response"}


def route_by_type(state: HomlyState) -> str:
    return state.get("message_type") or "unknown"


# Build the graph
builder = StateGraph(HomlyState)

builder.add_node("classify", classify_node)
builder.add_node("synthesise", synthesise_node)

builder.set_entry_point("classify")
builder.add_conditional_edges("classify", route_by_type, {
    "unknown": END,
})
builder.add_edge("synthesise", END)

graph = builder.compile()
