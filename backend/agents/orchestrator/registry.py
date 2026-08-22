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


def build_help_text() -> str:
    """WhatsApp-ready capabilities summary, one line per registered agent.

    Built from each agent's manifest.examples rather than hand-maintained
    separately, so it can't drift out of sync the way a duplicated doc would —
    see api/routers/internal.py's GET /internal/help and
    backend/whatsapp/index.js's handleHelpCommand().
    """
    lines = ["Here's what I can help with — just ask naturally, e.g.:", ""]
    for a in AGENTS:
        m = a.manifest
        if not m.examples:
            continue
        label = m.name.replace("_", " ").title()
        lines.append(f"• *{label}* — \"{m.examples[0]}\"")
    lines.append("")
    lines.append("Just message me like you would a person — I'll figure out what you need.")
    return "\n".join(lines)
