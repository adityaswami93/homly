from agents.base_agent import BaseQueryAgent
from agents.query.budget_agent import BudgetQueryAgent
from agents.query.grocery_agent import GroceryQueryAgent
from agents.query.insurance_query_agent import InsuranceQueryAgent
from agents.query.pantry_agent import PantryQueryAgent
from agents.query.preferences_agent import PreferencesQueryAgent
from agents.query.reminders_agent import RemindersQueryAgent
from agents.query.savings_query_agent import SavingsQueryAgent
from agents.query.tasks_agent import TasksQueryAgent

# The extensibility point: add a new domain's agent here and it's immediately
# routable by the supervisor — nothing else in agents/orchestrator/ needs to change.
AGENTS: list[BaseQueryAgent] = [
    GroceryQueryAgent(),
    InsuranceQueryAgent(),
    PantryQueryAgent(),
    SavingsQueryAgent(),
    BudgetQueryAgent(),
    RemindersQueryAgent(),
    TasksQueryAgent(),
    PreferencesQueryAgent(),
]
AGENT_BY_TOOL_NAME: dict[str, BaseQueryAgent] = {a.manifest.tool_name: a for a in AGENTS}
