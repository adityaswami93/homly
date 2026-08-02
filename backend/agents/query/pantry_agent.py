import logging
import os
from datetime import datetime, timezone

from supabase import create_client

from agents.base_agent import AgentManifest, AgentResult, BaseQueryAgent
from services.shopping_list import add_auto_item

logger = logging.getLogger(__name__)

MANIFEST = AgentManifest(
    name="pantry",
    tool_name="query_pantry",
    description=(
        "Manages household pantry inventory. Handles adding items, marking items as used or low, "
        "checking what's in stock, and answering questions about pantry state."
    ),
    intents=[
        {"name": "add_item",   "description": "Add or update an item in the pantry"},
        {"name": "mark_used",  "description": "Mark an item as out of stock or depleted"},
        {"name": "mark_low",   "description": "Mark an item as running low"},
        {"name": "list_items", "description": "List pantry contents, optionally filtered by status"},
        {"name": "check_item", "description": "Check if a specific item is in the pantry and its status"},
    ],
    params_schema={
        "type": "object",
        "properties": {
            "item_name": {
                "type": "string",
                "description": "The name of the pantry item",
            },
            "quantity": {
                "type": "number",
                "description": "Quantity for add_item",
            },
            "unit": {
                "type": "string",
                "description": "Unit for add_item (kg, g, L, pcs, etc.)",
            },
            "status": {
                "type": "string",
                "description": "Status for add_item: in_stock, low, or out_of_stock",
            },
            "status_filter": {
                "type": "string",
                "description": "For list_items: all, in_stock, low, or out_of_stock",
            },
        },
    },
)


class PantryQueryAgent(BaseQueryAgent):
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
            if intent == "add_item":
                return self._add_item(params, household_id)
            if intent == "mark_used":
                return self._set_status(params, household_id, "out_of_stock")
            if intent == "mark_low":
                return self._set_status(params, household_id, "low")
            if intent == "list_items":
                return self._list_items(params, household_id)
            if intent == "check_item":
                return self._check_item(params, household_id)
        except Exception as e:
            logger.exception("Pantry agent failed to handle intent=%s household_id=%s", intent, household_id)
            return AgentResult(
                agent="pantry",
                handled=False,
                intent=intent,
                data={"error": str(e)},
                natural_language=f"Sorry, I couldn't update the pantry: {e}",
            )
        return AgentResult(
            agent="pantry", handled=False, intent=intent, data={}, natural_language="Unknown intent."
        )

    def _canonical(self, name: str) -> str:
        return (name or "").strip().lower()

    def _add_item(self, params: dict, household_id: str) -> AgentResult:
        name = self._canonical(params.get("item_name", ""))
        if not name:
            return AgentResult(agent="pantry", handled=False, intent="add_item", data={},
                               natural_language="Please specify an item name.")
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "household_id":   household_id,
            "canonical_name": name,
            "quantity":       params.get("quantity"),
            "unit":           params.get("unit"),
            "status":         params.get("status", "in_stock"),
            "added_by":       "bot",
            "last_updated":   now,
        }
        self._db().table("pantry_items").upsert(row, on_conflict="household_id,canonical_name").execute()
        qty_str = f" ({params['quantity']} {params.get('unit', '')})" if params.get("quantity") else ""
        return AgentResult(
            agent="pantry", handled=True, intent="add_item",
            data={"canonical_name": name},
            natural_language=f"Got it — added *{name}*{qty_str} to your pantry as in stock.",
        )

    def _set_status(self, params: dict, household_id: str, status: str) -> AgentResult:
        name = self._canonical(params.get("item_name", ""))
        if not name:
            return AgentResult(agent="pantry", handled=False, intent="mark_used", data={},
                               natural_language="Please specify an item name.")
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "household_id":   household_id,
            "canonical_name": name,
            "status":         status,
            "added_by":       "bot",
            "last_updated":   now,
        }
        self._db().table("pantry_items").upsert(row, on_conflict="household_id,canonical_name").execute()
        if status == "out_of_stock":
            add_auto_item(self._db(), household_id, name)
            nl = f"Marked *{name}* as used up and added it to the shopping list."
        else:
            nl = f"Marked *{name}* as running low. It will show up on the shopping list for your next recipe."
        return AgentResult(agent="pantry", handled=True, intent="mark_used" if status == "out_of_stock" else "mark_low",
                           data={"canonical_name": name, "status": status}, natural_language=nl)

    def _list_items(self, params: dict, household_id: str) -> AgentResult:
        status_filter = params.get("status_filter", "all")
        q = (
            self._db()
            .table("pantry_items")
            .select("canonical_name, status, quantity, unit")
            .eq("household_id", household_id)
            .order("status")
            .order("canonical_name")
        )
        if status_filter and status_filter != "all":
            q = q.eq("status", status_filter)
        res = q.execute()
        items = res.data
        if not items:
            label = f"with status '{status_filter}'" if status_filter and status_filter != "all" else ""
            return AgentResult(agent="pantry", handled=True, intent="list_items", data={"items": []},
                               natural_language=f"No pantry items found {label}. Add some by texting me 'added rice' or similar.")

        by_status: dict[str, list] = {}
        for item in items:
            by_status.setdefault(item["status"], []).append(item["canonical_name"])

        parts = []
        if by_status.get("in_stock"):
            parts.append("In stock: " + ", ".join(by_status["in_stock"]))
        if by_status.get("low"):
            parts.append("Running low: " + ", ".join(by_status["low"]))
        if by_status.get("out_of_stock"):
            parts.append("Out of stock: " + ", ".join(by_status["out_of_stock"]))

        return AgentResult(agent="pantry", handled=True, intent="list_items", data={"items": items},
                           natural_language=". ".join(parts) + f". ({len(items)} items total)")

    def _check_item(self, params: dict, household_id: str) -> AgentResult:
        name = self._canonical(params.get("item_name", ""))
        if not name:
            return AgentResult(agent="pantry", handled=False, intent="check_item", data={},
                               natural_language="Please specify an item to check.")
        res = (
            self._db()
            .table("pantry_items")
            .select("canonical_name, status, quantity, unit, last_updated")
            .eq("household_id", household_id)
            .ilike("canonical_name", f"%{name}%")
            .limit(1)
            .execute()
        )
        if not res.data:
            return AgentResult(agent="pantry", handled=True, intent="check_item", data={"found": False},
                               natural_language=f"*{name}* isn't in your pantry yet. Text me 'added {name}' to add it.")
        item = res.data[0]
        status_labels = {"in_stock": "in stock ✅", "low": "running low ⚠️", "out_of_stock": "out of stock ❌"}
        label = status_labels.get(item["status"], item["status"])
        return AgentResult(agent="pantry", handled=True, intent="check_item", data={"item": item},
                           natural_language=f"*{item['canonical_name']}* is {label}.")
