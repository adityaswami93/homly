import os

from supabase import create_client

from agents.base_agent import AgentManifest, AgentResult, BaseQueryAgent

MANIFEST = AgentManifest(
    name="savings",
    tool_name="query_savings",
    description=(
        "Answers questions about household savings and investment accounts: "
        "net worth, listing accounts, and breakdown by account type "
        "(bank savings, fixed deposits, retirement funds like CPF/EPF/PPF/NPS, stocks, mutual funds, etc.)."
    ),
    intents=[
        {
            "name": "list_accounts",
            "description": "List all active savings/investment accounts with key details",
        },
        {
            "name": "net_worth",
            "description": "Total net worth across all accounts",
        },
        {
            "name": "account_type_breakdown",
            "description": "Net worth broken down by account type (e.g. how much is in fixed deposits vs stocks)",
        },
    ],
    params_schema={"type": "object", "properties": {}},
)


class SavingsQueryAgent(BaseQueryAgent):
    def __init__(self):
        self._supabase = None

    @property
    def manifest(self) -> AgentManifest:
        return MANIFEST

    def _db(self):
        if self._supabase is None:
            self._supabase = create_client(
                os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY")
            )
        return self._supabase

    def handle(self, intent: str, params: dict, household_id: str) -> AgentResult:
        try:
            if intent == "list_accounts":
                return self._list_accounts(household_id)
            if intent == "net_worth":
                return self._net_worth(household_id)
            if intent == "account_type_breakdown":
                return self._breakdown(household_id)
        except Exception as e:
            return AgentResult(
                agent="savings",
                handled=False,
                intent=intent,
                data={"error": str(e)},
                natural_language=f"Sorry, I couldn't retrieve that data: {e}",
            )
        return AgentResult(
            agent="savings",
            handled=False,
            intent=intent,
            data={},
            natural_language="Unknown intent.",
        )

    def _accounts(self, household_id: str) -> list[dict]:
        res = (
            self._db()
            .table("savings_accounts")
            .select("account_type, scheme_name, institution, account_name, current_balance, currency")
            .eq("household_id", household_id)
            .eq("is_active", True)
            .execute()
        )
        return res.data or []

    def _list_accounts(self, household_id) -> AgentResult:
        accounts = self._accounts(household_id)
        if not accounts:
            return AgentResult(
                agent="savings",
                handled=True,
                intent="list_accounts",
                data={"accounts": []},
                natural_language="No savings or investment accounts found.",
            )

        lines = []
        for a in accounts:
            label = a.get("scheme_name") or a["account_type"].replace("_", " ")
            line = f"{a['account_name']} ({label})"
            if a.get("institution"):
                line += f" — {a['institution']}"
            line += f": {a['currency']} {a['current_balance']:,.2f}"
            lines.append(line)

        nl = f"You have {len(accounts)} active account(s): " + "; ".join(lines) + "."
        return AgentResult(
            agent="savings",
            handled=True,
            intent="list_accounts",
            data={"accounts": accounts},
            natural_language=nl,
        )

    def _net_worth(self, household_id) -> AgentResult:
        accounts = self._accounts(household_id)

        # Balances are never summed across currencies — group by currency
        # instead, since a household can hold accounts in more than one.
        by_currency: dict[str, float] = {}
        for a in accounts:
            by_currency[a["currency"]] = by_currency.get(a["currency"], 0) + (a["current_balance"] or 0)

        if not by_currency:
            nl = "No savings or investment accounts found."
        elif len(by_currency) == 1:
            currency, total = next(iter(by_currency.items()))
            nl = f"Total net worth is {currency} {total:,.2f} across {len(accounts)} account(s)."
        else:
            parts = "; ".join(f"{c} {v:,.2f}" for c, v in by_currency.items())
            nl = f"Net worth by currency — {parts} — across {len(accounts)} account(s)."

        return AgentResult(
            agent="savings",
            handled=True,
            intent="net_worth",
            data={
                "totals_by_currency": {c: round(v, 2) for c, v in by_currency.items()},
                "account_count": len(accounts),
            },
            natural_language=nl,
        )

    def _breakdown(self, household_id) -> AgentResult:
        accounts = self._accounts(household_id)
        if not accounts:
            return AgentResult(
                agent="savings",
                handled=True,
                intent="account_type_breakdown",
                data={"by_type": {}},
                natural_language="No savings or investment accounts found.",
            )

        # Keyed by (currency, type) so mixed-currency households never sum
        # balances of different currencies into one number.
        by_currency_type: dict[tuple[str, str], float] = {}
        for a in accounts:
            key = (a["currency"], a["account_type"])
            by_currency_type[key] = by_currency_type.get(key, 0) + (a["current_balance"] or 0)

        currencies = {a["currency"] for a in accounts}
        if len(currencies) == 1:
            currency = next(iter(currencies))
            lines = [f"{t.replace('_', ' ')}: {currency} {v:,.2f}" for (_, t), v in by_currency_type.items()]
        else:
            lines = [f"{t.replace('_', ' ')} ({c}): {v:,.2f}" for (c, t), v in by_currency_type.items()]
        nl = "Breakdown by account type — " + "; ".join(lines) + "."

        by_type: dict[str, dict[str, float]] = {}
        for (c, t), v in by_currency_type.items():
            by_type.setdefault(c, {})[t] = round(v, 2)

        return AgentResult(
            agent="savings",
            handled=True,
            intent="account_type_breakdown",
            data={"by_type": by_type},
            natural_language=nl,
        )
