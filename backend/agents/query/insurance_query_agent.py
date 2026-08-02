import json
import os
from datetime import date, timedelta

from supabase import create_client

from agents.base_agent import AgentManifest, AgentResult, BaseQueryAgent
from services.llm_client import get_completion

MANIFEST = AgentManifest(
    name="insurance",
    tool_name="query_insurance",
    description=(
        "Answers questions about household insurance policies: "
        "listing active policies, upcoming renewals, total premium spend, "
        "and natural language coverage questions."
    ),
    intents=[
        {
            "name": "list_policies",
            "description": "List all active insurance policies with key details",
        },
        {
            "name": "renewal_check",
            "description": "Show policies renewing soon (within N days)",
        },
        {
            "name": "premium_spend",
            "description": "Calculate total annual and monthly premium expenditure",
        },
        {
            "name": "coverage_lookup",
            "description": "Answer a natural language question about coverage (e.g. 'are we covered for hospitalisation?')",
        },
    ],
    params_schema={
        "type": "object",
        "properties": {
            "days_ahead": {
                "type": "integer",
                "description": "For renewal_check: how many days ahead to look (default 30)",
            },
            "coverage_question": {
                "type": "string",
                "description": "For coverage_lookup: the user's natural language coverage question",
            },
        },
    },
)


class InsuranceQueryAgent(BaseQueryAgent):
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

    def handle(self, intent: str, params: dict, household_id: str,
               sender_name: str | None = None, sender_phone: str | None = None) -> AgentResult:
        try:
            if intent == "list_policies":
                return self._list_policies(household_id)
            if intent == "renewal_check":
                return self._renewal_check(params, household_id)
            if intent == "premium_spend":
                return self._premium_spend(household_id)
            if intent == "coverage_lookup":
                return self._coverage_lookup(params, household_id)
        except Exception as e:
            return AgentResult(
                agent="insurance",
                handled=False,
                intent=intent,
                data={"error": str(e)},
                natural_language=f"Sorry, I couldn't retrieve that data: {e}",
            )
        return AgentResult(
            agent="insurance",
            handled=False,
            intent=intent,
            data={},
            natural_language="Unknown intent.",
        )

    # ── intents ──────────────────────────────────────────────────────────────

    def _list_policies(self, household_id) -> AgentResult:
        res = (
            self._db()
            .table("insurance_policies")
            .select(
                "provider, coverage_type, insured_person, "
                "premium_amount, premium_frequency, renewal_date, policy_number"
            )
            .eq("household_id", household_id)
            .eq("is_active", True)
            .order("coverage_type")
            .execute()
        )
        policies = res.data
        if not policies:
            return AgentResult(
                agent="insurance",
                handled=True,
                intent="list_policies",
                data={"policies": []},
                natural_language="No active insurance policies found.",
            )

        lines = []
        for p in policies:
            line = f"{p['provider']} ({p['coverage_type']})"
            if p.get("insured_person"):
                line += f" — {p['insured_person']}"
            if p.get("renewal_date"):
                line += f", renews {p['renewal_date']}"
            lines.append(line)

        nl = f"You have {len(policies)} active policy(ies): " + "; ".join(lines) + "."
        return AgentResult(
            agent="insurance",
            handled=True,
            intent="list_policies",
            data={"policies": policies},
            natural_language=nl,
        )

    def _renewal_check(self, params, household_id) -> AgentResult:
        days_ahead = int(params.get("days_ahead") or 30)
        today = date.today()
        cutoff = today + timedelta(days=days_ahead)

        res = (
            self._db()
            .table("insurance_policies")
            .select(
                "provider, coverage_type, insured_person, "
                "renewal_date, premium_amount, premium_frequency"
            )
            .eq("household_id", household_id)
            .eq("is_active", True)
            .gte("renewal_date", today.isoformat())
            .lte("renewal_date", cutoff.isoformat())
            .order("renewal_date")
            .execute()
        )
        policies = res.data
        if not policies:
            nl = f"No policies renewing in the next {days_ahead} days."
        else:
            lines = [
                f"{p['provider']} ({p['coverage_type']}) on {p['renewal_date']}"
                for p in policies
            ]
            nl = (
                f"{len(policies)} policy(ies) renewing in the next {days_ahead} days: "
                + "; ".join(lines)
                + "."
            )

        return AgentResult(
            agent="insurance",
            handled=True,
            intent="renewal_check",
            data={"policies": policies, "days_ahead": days_ahead},
            natural_language=nl,
        )

    def _premium_spend(self, household_id) -> AgentResult:
        res = (
            self._db()
            .table("insurance_policies")
            .select("provider, coverage_type, premium_amount, premium_frequency")
            .eq("household_id", household_id)
            .eq("is_active", True)
            .execute()
        )
        policies = res.data
        freq_multipliers = {"monthly": 12, "quarterly": 4, "annually": 1}
        annual_total = sum(
            p["premium_amount"] * freq_multipliers.get(p["premium_frequency"], 1)
            for p in policies
            if p.get("premium_amount") and p.get("premium_frequency")
        )
        annual = round(annual_total, 2)
        monthly = round(annual_total / 12, 2)

        nl = (
            f"Total insurance premiums: SGD {annual:.2f}/year "
            f"(SGD {monthly:.2f}/month) across {len(policies)} active policies."
        )
        return AgentResult(
            agent="insurance",
            handled=True,
            intent="premium_spend",
            data={"annual_total": annual, "monthly_total": monthly, "policies": policies},
            natural_language=nl,
        )

    def _coverage_lookup(self, params, household_id) -> AgentResult:
        question = (params.get("coverage_question") or "").strip()
        if not question:
            return AgentResult(
                agent="insurance",
                handled=False,
                intent="coverage_lookup",
                data={},
                natural_language="Please ask a specific coverage question.",
            )

        res = (
            self._db()
            .table("insurance_policies")
            .select("provider, coverage_type, coverage_details, document_summary, policy_number")
            .eq("household_id", household_id)
            .eq("is_active", True)
            .not_.is_("coverage_details", "null")
            .execute()
        )

        if not res.data:
            return AgentResult(
                agent="insurance",
                handled=True,
                intent="coverage_lookup",
                data={},
                natural_language=(
                    "No analyzed policies found. "
                    "Upload and analyze policy documents first to answer coverage questions."
                ),
            )

        context = "\n\n".join(
            f"Policy: {p['provider']} ({p['coverage_type']})\n"
            f"Coverage: {json.dumps(p['coverage_details'], indent=2)}"
            for p in res.data
        )
        prompt = (
            f"You are an insurance expert. Based on these policies:\n\n{context}\n\n"
            f"Question: {question}\n\n"
            "Answer in 2-3 clear sentences. Only use the provided policy data — do not invent coverage."
        )
        answer = get_completion(prompt)

        return AgentResult(
            agent="insurance",
            handled=True,
            intent="coverage_lookup",
            data={"question": question, "policies_consulted": len(res.data)},
            natural_language=answer,
        )
