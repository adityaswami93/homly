from operator import add
from typing import Annotated, Optional, TypedDict

from agents.base_agent import AgentResult


class SupervisorState(TypedDict):
    household_id: str
    query: str
    context: Optional[list[dict]]
    pending_tool_calls: Optional[list[dict]]
    agents_called: Annotated[list[str], add]
    agent_results: Annotated[list[AgentResult], add]
    response: Optional[str]
