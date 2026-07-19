from operator import add
from typing import Annotated, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

from agents.base_agent import AgentResult


class SupervisorState(TypedDict):
    household_id: str
    messages: Annotated[list[BaseMessage], add_messages]
    agents_called: Annotated[list[str], add]
    agent_results: Annotated[list[AgentResult], add]
    iterations: int
