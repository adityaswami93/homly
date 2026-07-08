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
        total = sum(a["current_balance"] or 0 for a in accounts)
        currency = accounts[0]["currency"] if accounts else "SGD"

        nl = f"Total net worth is {currency} {total:,.2f} across {len(accounts)} account(s)."
        return AgentResult(
            agent="savings",
            handled=True,
            intent="net_worth",
            data={"total": round(total, 2), "currency": currency, "account_count": len(accounts)},
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

        by_type: dict[str, float] = {}
        for a in accounts:
            by_type[a["account_type"]] = by_type.get(a["account_type"], 0) + (a["current_balance"] or 0)

        currency = accounts[0]["currency"]
        lines = [f"{t.replace('_', ' ')}: {currency} {v:,.2f}" for t, v in by_type.items()]
        nl = "Breakdown by account type — " + "; ".join(lines) + "."
        return AgentResult(
            agent="savings",
            handled=True,
            intent="account_type_breakdown",
            data={"by_type": {k: round(v, 2) for k, v in by_type.items()}, "currency": currency},
            natural_language=nl,
        )
