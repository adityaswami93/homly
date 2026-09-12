from datetime import date, timedelta

from services.db import get_supabase

from agents.base_agent import AgentManifest, AgentResult, BaseQueryAgent

MANIFEST = AgentManifest(
    name="grocery",
    tool_name="query_grocery",
    description=(
        "Answers questions about household grocery and expense data: "
        "spending by category or keyword, top vendors, most-bought items, "
        "price trends, and spending summaries."
    ),
    intents=[
        {
            "name": "spend_by_category",
            "description": "Total spending for a category (groceries, household, personal care, etc.) over a period",
        },
        {
            "name": "spend_by_keyword",
            "description": "Total spending on a specific item or keyword (e.g. 'milk', 'vegetables') over a period",
        },
        {
            "name": "top_vendors",
            "description": "Which stores/vendors the household shops at most, ranked by spend",
        },
        {
            "name": "top_items",
            "description": "Most frequently purchased items or highest-spend items",
        },
        {
            "name": "price_trend",
            "description": "How the price of a specific item has changed over time",
        },
        {
            "name": "spend_summary",
            "description": "Total household spending summary for a period",
        },
    ],
    params_schema={
        "type": "object",
        "properties": {
            "period": {
                "type": "string",
                "enum": [
                    "this_week",
                    "last_week",
                    "this_month",
                    "last_month",
                    "last_7_days",
                    "last_30_days",
                ],
                "description": "Time window for the query",
            },
            "keyword": {
                "type": "string",
                "description": "Item name or search term (for spend_by_keyword and price_trend)",
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
                "description": "Item category (for spend_by_category and top_items)",
            },
        },
    },
    examples=["how much did we spend on groceries this month?", "what are our top vendors this week?"],
)


def _resolve_period(period: str) -> tuple[date, date]:
    today = date.today()
    if period == "this_week":
        start = today - timedelta(days=today.weekday())
        return start, today
    if period == "last_week":
        start = today - timedelta(days=today.weekday() + 7)
        return start, start + timedelta(days=6)
    if period == "this_month":
        return today.replace(day=1), today
    if period == "last_month":
        last_day = today.replace(day=1) - timedelta(days=1)
        return last_day.replace(day=1), last_day
    if period == "last_7_days":
        return today - timedelta(days=6), today
    return today - timedelta(days=29), today  # last_30_days default


def _period_label(period: str) -> str:
    return period.replace("_", " ")


class GroceryQueryAgent(BaseQueryAgent):
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
        period = params.get("period", "last_30_days")
        date_from, date_to = _resolve_period(period)
        try:
            if intent == "spend_by_category":
                return self._spend_by_category(params, household_id, date_from, date_to, period)
            if intent == "spend_by_keyword":
                return self._spend_by_keyword(params, household_id, date_from, date_to, period)
            if intent == "top_vendors":
                return self._top_vendors(household_id, date_from, date_to, period)
            if intent == "top_items":
                return self._top_items(params, household_id, date_from, date_to, period)
            if intent == "price_trend":
                return self._price_trend(params, household_id)
            if intent == "spend_summary":
                return self._spend_summary(household_id, date_from, date_to, period)
        except Exception as e:
            return AgentResult(
                agent="grocery",
                handled=False,
                intent=intent,
                data={"error": str(e)},
                natural_language=f"Sorry, I couldn't retrieve that data: {e}",
            )
        return AgentResult(
            agent="grocery",
            handled=False,
            intent=intent,
            data={},
            natural_language="I don't know how to handle that intent.",
        )

    # ── intents ──────────────────────────────────────────────────────────────

    def _spend_by_category(self, params, household_id, date_from, date_to, period):
        category = params.get("category")
        q = (
            self._db()
            .table("items")
            .select("category, line_total")
            .eq("household_id", household_id)
            .gte("receipt_date", date_from.isoformat())
            .lte("receipt_date", date_to.isoformat())
        )
        if category:
            q = q.eq("category", category)
        res = q.execute()

        totals: dict[str, float] = {}
        for item in res.data:
            cat = item["category"] or "other"
            totals[cat] = round(totals.get(cat, 0) + (item["line_total"] or 0), 2)

        if category:
            total = totals.get(category, 0)
            nl = f"You spent SGD {total:.2f} on {category} {_period_label(period)}."
        else:
            ranked = sorted(totals.items(), key=lambda x: x[1], reverse=True)
            lines = ", ".join(f"{c}: SGD {v:.2f}" for c, v in ranked)
            nl = f"Spending by category {_period_label(period)}: {lines}." if ranked else f"No spending found {_period_label(period)}."

        return AgentResult(
            agent="grocery",
            handled=True,
            intent="spend_by_category",
            data={
                "category_totals": totals,
                "period": period,
                "date_from": date_from.isoformat(),
                "date_to": date_to.isoformat(),
            },
            natural_language=nl,
        )

    def _spend_by_keyword(self, params, household_id, date_from, date_to, period):
        keyword = (params.get("keyword") or "").strip()
        if not keyword:
            return AgentResult(
                agent="grocery",
                handled=False,
                intent="spend_by_keyword",
                data={},
                natural_language="Please specify an item name.",
            )

        res = (
            self._db()
            .table("items")
            .select("canonical_name, name, line_total, unit_price, qty, receipt_date, vendor")
            .eq("household_id", household_id)
            .ilike("canonical_name", f"%{keyword.lower()}%")
            .gte("receipt_date", date_from.isoformat())
            .lte("receipt_date", date_to.isoformat())
            .order("receipt_date", desc=False)
            .execute()
        )

        total = round(sum(i["line_total"] or 0 for i in res.data), 2)
        count = len(res.data)

        if count == 0:
            nl = f"No purchases matching '{keyword}' found {_period_label(period)}."
        else:
            nl = (
                f"You bought '{keyword}' {count} time(s) {_period_label(period)}, "
                f"spending SGD {total:.2f} in total."
            )

        return AgentResult(
            agent="grocery",
            handled=True,
            intent="spend_by_keyword",
            data={
                "keyword": keyword,
                "total": total,
                "purchase_count": count,
                "items": res.data,
                "period": period,
                "date_from": date_from.isoformat(),
                "date_to": date_to.isoformat(),
            },
            natural_language=nl,
        )

    def _top_vendors(self, household_id, date_from, date_to, period):
        res = (
            self._db()
            .table("receipts")
            .select("vendor, total")
            .eq("household_id", household_id)
            .eq("deleted", False)
            .gte("date", date_from.isoformat())
            .lte("date", date_to.isoformat())
            .execute()
        )

        totals: dict[str, float] = {}
        counts: dict[str, int] = {}
        for r in res.data:
            v = r.get("vendor") or "Unknown"
            totals[v] = round(totals.get(v, 0) + (r["total"] or 0), 2)
            counts[v] = counts.get(v, 0) + 1

        ranked = sorted(totals.items(), key=lambda x: x[1], reverse=True)[:5]
        if ranked:
            lines = ", ".join(
                f"{v}: SGD {t:.2f} ({counts[v]} trip{'s' if counts[v] != 1 else ''})"
                for v, t in ranked
            )
            nl = f"Top vendors {_period_label(period)}: {lines}."
        else:
            nl = f"No receipts found {_period_label(period)}."

        return AgentResult(
            agent="grocery",
            handled=True,
            intent="top_vendors",
            data={
                "vendors": [
                    {"vendor": v, "total": t, "trips": counts[v]} for v, t in ranked
                ],
                "period": period,
            },
            natural_language=nl,
        )

    def _top_items(self, params, household_id, date_from, date_to, period):
        category = params.get("category")
        q = (
            self._db()
            .table("items")
            .select("canonical_name, line_total")
            .eq("household_id", household_id)
            .gte("receipt_date", date_from.isoformat())
            .lte("receipt_date", date_to.isoformat())
        )
        if category:
            q = q.eq("category", category)
        res = q.execute()

        totals: dict[str, float] = {}
        counts: dict[str, int] = {}
        for i in res.data:
            name = i.get("canonical_name") or "unknown"
            totals[name] = round(totals.get(name, 0) + (i["line_total"] or 0), 2)
            counts[name] = counts.get(name, 0) + 1

        ranked = sorted(totals.items(), key=lambda x: x[1], reverse=True)[:10]
        if ranked:
            lines = ", ".join(f"{n} (SGD {t:.2f})" for n, t in ranked[:5])
            nl = f"Top items by spend {_period_label(period)}: {lines}."
        else:
            nl = f"No items found {_period_label(period)}."

        return AgentResult(
            agent="grocery",
            handled=True,
            intent="top_items",
            data={
                "items": [
                    {"name": n, "total": t, "count": counts[n]} for n, t in ranked
                ],
                "period": period,
            },
            natural_language=nl,
        )

    def _price_trend(self, params, household_id):
        keyword = (params.get("keyword") or "").strip()
        if not keyword:
            return AgentResult(
                agent="grocery",
                handled=False,
                intent="price_trend",
                data={},
                natural_language="Please specify an item name.",
            )

        res = (
            self._db()
            .table("items")
            .select("canonical_name, unit_price, receipt_date, vendor")
            .eq("household_id", household_id)
            .ilike("canonical_name", f"%{keyword.lower()}%")
            .not_.is_("unit_price", "null")
            .order("receipt_date", desc=False)
            .limit(50)
            .execute()
        )

        if not res.data:
            return AgentResult(
                agent="grocery",
                handled=True,
                intent="price_trend",
                data={"keyword": keyword, "prices": []},
                natural_language=f"No price history found for '{keyword}'.",
            )

        prices = res.data
        first, last = prices[0], prices[-1]
        change_pct = (
            ((last["unit_price"] - first["unit_price"]) / first["unit_price"] * 100)
            if first["unit_price"]
            else 0
        )
        direction = "up" if change_pct > 0 else ("down" if change_pct < 0 else "unchanged")
        nl = (
            f"Price of '{keyword}' has gone {direction} {abs(change_pct):.1f}% — "
            f"from SGD {first['unit_price']:.2f} on {first['receipt_date']} "
            f"to SGD {last['unit_price']:.2f} on {last['receipt_date']}."
        )

        return AgentResult(
            agent="grocery",
            handled=True,
            intent="price_trend",
            data={
                "keyword": keyword,
                "prices": prices,
                "first_price": first["unit_price"],
                "last_price": last["unit_price"],
                "change_pct": round(change_pct, 1),
            },
            natural_language=nl,
        )

    def _spend_summary(self, household_id, date_from, date_to, period):
        res = (
            self._db()
            .table("receipts")
            .select("total, reimbursable, flagged")
            .eq("household_id", household_id)
            .eq("deleted", False)
            .gte("date", date_from.isoformat())
            .lte("date", date_to.isoformat())
            .execute()
        )

        total = round(sum(r["total"] or 0 for r in res.data), 2)
        reimbursable = round(sum(r["total"] or 0 for r in res.data if r.get("reimbursable")), 2)
        own = round(total - reimbursable, 2)
        count = len(res.data)

        nl = (
            f"You spent SGD {total:.2f} {_period_label(period)} across {count} receipt(s). "
            f"Own: SGD {own:.2f}, reimbursable: SGD {reimbursable:.2f}."
        )

        return AgentResult(
            agent="grocery",
            handled=True,
            intent="spend_summary",
            data={
                "total": total,
                "own": own,
                "reimbursable": reimbursable,
                "receipt_count": count,
                "period": period,
                "date_from": date_from.isoformat(),
                "date_to": date_to.isoformat(),
            },
            natural_language=nl,
        )
