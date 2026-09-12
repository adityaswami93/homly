from datetime import date, timedelta, datetime, timezone

from services.db import get_supabase

from agents.base_agent import AgentManifest, AgentResult, BaseQueryAgent

MANIFEST = AgentManifest(
    name="budgets",
    tool_name="query_budgets",
    description=(
        "Answers questions about household budgets: how much has been spent against "
        "a monthly budget, which categories are over, and setting new budget targets."
    ),
    intents=[
        {
            "name": "budget_status",
            "description": "Compare actual spending to budget for a month — overall or a single category",
        },
        {
            "name": "set_budget",
            "description": "Set (or update) the budget amount for a month, overall or for a category",
        },
    ],
    params_schema={
        "type": "object",
        "properties": {
            "month": {
                "type": "string",
                "description": "Month as YYYY-MM. Defaults to the current month if omitted.",
            },
            "category": {
                "type": "string",
                "enum": [
                    "groceries",
                    "household",
                    "personal care",
                    "food & beverage",
                    "transport",
                    "other",
                ],
                "description": "Budget category. Omit for the overall household budget.",
            },
            "amount": {
                "type": "number",
                "description": "Budget amount (for set_budget)",
            },
        },
    },
    examples=["how are we doing on our groceries budget this month?", "set our overall budget to 2000 for this month"],
)


def _current_month() -> str:
    return date.today().strftime("%Y-%m")


def _month_range(month: str) -> tuple[date, date]:
    year, mon = (int(p) for p in month.split("-"))
    start = date(year, mon, 1)
    end = date(year + 1, 1, 1) - timedelta(days=1) if mon == 12 else date(year, mon + 1, 1) - timedelta(days=1)
    return start, end


class BudgetQueryAgent(BaseQueryAgent):
    def __init__(self):
        self._supabase = None

    @property
    def manifest(self) -> AgentManifest:
        return MANIFEST

    def _db(self):
        if self._supabase is None:
            self._supabase = get_supabase()
        return self._supabase

    def handle(self, intent: str, params: dict, household_id: str,
               sender_name: str | None = None, sender_phone: str | None = None) -> AgentResult:
        try:
            if intent == "budget_status":
                return self._budget_status(params, household_id)
            if intent == "set_budget":
                return self._set_budget(params, household_id)
        except Exception as e:
            return AgentResult(
                agent="budgets",
                handled=False,
                intent=intent,
                data={"error": str(e)},
                natural_language=f"Sorry, I couldn't retrieve that data: {e}",
            )
        return AgentResult(
            agent="budgets",
            handled=False,
            intent=intent,
            data={},
            natural_language="I don't know how to handle that intent.",
        )

    def _category_spend(self, household_id: str, start: date, end: date) -> dict[str, float]:
        res = (
            self._db()
            .table("items")
            .select("category, line_total")
            .eq("household_id", household_id)
            .gte("receipt_date", start.isoformat())
            .lte("receipt_date", end.isoformat())
            .execute()
        )
        totals: dict[str, float] = {}
        for item in res.data:
            cat = item["category"] or "other"
            totals[cat] = round(totals.get(cat, 0) + (item["line_total"] or 0), 2)
        return totals

    def _overall_spend(self, household_id: str, start: date, end: date) -> float:
        res = (
            self._db()
            .table("receipts")
            .select("total")
            .eq("household_id", household_id)
            .eq("deleted", False)
            .gte("date", start.isoformat())
            .lte("date", end.isoformat())
            .execute()
        )
        return round(sum(r["total"] or 0 for r in res.data), 2)

    def _budget_status(self, params: dict, household_id: str) -> AgentResult:
        month = params.get("month") or _current_month()
        category = params.get("category")
        start, end = _month_range(month)

        budgets_res = (
            self._db()
            .table("budgets")
            .select("category, amount")
            .eq("household_id", household_id)
            .eq("month", month)
            .execute()
        )
        budgets = budgets_res.data or []
        if category:
            budgets = [b for b in budgets if b["category"] == category]

        if not budgets:
            scope = f"for {category} " if category else ""
            nl = f"No budget set {scope}for {month}. Ask me to set one, e.g. \"set groceries budget to 400 for {month}\"."
            return AgentResult(
                agent="budgets", handled=True, intent="budget_status",
                data={"month": month, "budgets": []}, natural_language=nl,
            )

        category_spend = self._category_spend(household_id, start, end)
        overall_spend = self._overall_spend(household_id, start, end)

        rows = []
        lines = []
        for b in budgets:
            cat = b["category"]
            budget_amount = b["amount"]
            actual = overall_spend if cat is None else category_spend.get(cat, 0)
            remaining = round(budget_amount - actual, 2)
            pct = round((actual / budget_amount) * 100, 1) if budget_amount else 0
            label = cat or "overall"
            rows.append({
                "category": label,
                "budget": budget_amount,
                "actual": actual,
                "remaining": remaining,
                "pct_used": pct,
                "over": actual > budget_amount,
            })
            status = "over by SGD {:.2f}".format(-remaining) if remaining < 0 else f"SGD {remaining:.2f} remaining"
            lines.append(f"{label}: SGD {actual:.2f} of SGD {budget_amount:.2f} ({pct:.0f}%, {status})")

        nl = f"Budget status for {month} — " + "; ".join(lines) + "."

        return AgentResult(
            agent="budgets", handled=True, intent="budget_status",
            data={"month": month, "budgets": rows}, natural_language=nl,
        )

    def _set_budget(self, params: dict, household_id: str) -> AgentResult:
        amount = params.get("amount")
        if amount is None or amount <= 0:
            return AgentResult(
                agent="budgets", handled=False, intent="set_budget", data={},
                natural_language="Please specify a positive budget amount.",
            )
        month = params.get("month") or _current_month()
        category = params.get("category")

        row = {
            "household_id": household_id,
            "month":        month,
            "category":     category,
            "amount":       amount,
            "updated_at":   datetime.now(timezone.utc).isoformat(),
        }
        self._db().table("budgets").upsert(row, on_conflict="household_id,month,category").execute()

        label = category or "overall"
        nl = f"Set {label} budget to SGD {amount:.2f} for {month}."
        return AgentResult(
            agent="budgets", handled=True, intent="set_budget",
            data={"month": month, "category": category, "amount": amount}, natural_language=nl,
        )
