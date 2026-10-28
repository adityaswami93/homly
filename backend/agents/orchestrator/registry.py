from agents.base_agent import BaseQueryAgent
from agents.query.budget_agent import BudgetQueryAgent
from agents.query.documents_agent import DocumentsQueryAgent
from agents.query.grocery_agent import GroceryQueryAgent
from agents.query.insurance_query_agent import InsuranceQueryAgent
from agents.query.pantry_agent import PantryQueryAgent
from agents.query.preferences_agent import PreferencesQueryAgent
from agents.query.reminders_agent import RemindersQueryAgent
from agents.query.savings_query_agent import SavingsQueryAgent
from agents.query.tasks_agent import TasksQueryAgent
from agents.query.vouchers_agent import VouchersQueryAgent

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
    VouchersQueryAgent(),
    DocumentsQueryAgent(),
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


# What agents/document_reader.py may offer to do with a photo it just read.
# Hand-picked intents rather than every intent of every agent: a suggestion is
# something the group can say "yes" to, so it has to be a *write* the chat
# supervisor can then carry out with one of these tools. Keyed by tool name so
# a renamed or removed agent drops out instead of being offered.
_PHOTO_ACTIONS: dict[str, str] = {
    "query_reminders":   "set a reminder for a date/time (e.g. a payment deadline or an appointment)",
    "query_tasks":       "add a chore or to-do for the household, or add items to the shopping list",
    "query_vouchers":    "save a voucher or promo code to the household's voucher wallet",
    "query_preferences": "remember a standing fact or preference about the household",
    "query_pantry":      "add items to the pantry",
}


def describe_capabilities() -> str:
    """Bullet list of what a read photo can turn into, for document_reader's prompt."""
    lines = [
        f"  - {desc}" for tool, desc in _PHOTO_ACTIONS.items() if tool in AGENT_BY_TOOL_NAME
    ]
    lines.append("  - just keep it so the family can ask about it later (always possible)")
    return "\n".join(lines)
