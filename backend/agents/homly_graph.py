import json
import logging
import os
from operator import add
from typing import Annotated, Optional, TypedDict

from langgraph.graph import END, StateGraph

logger = logging.getLogger(__name__)

# ── State ─────────────────────────────────────────────────────────────────────


class HomlyState(TypedDict):
    # Identity
    household_id: str
    group_jid: Optional[str]

    # Input — one of these will be populated per invocation
    query: Optional[str]         # text message from WhatsApp or API
    image_bytes: Optional[bytes]
    image_mime: Optional[str]

    # WhatsApp message metadata (needed for dedup + attribution when saving receipts)
    whatsapp_message_id: Optional[str]
    sender_name: Optional[str]
    sender_phone: Optional[str]

    # Classification result
    message_type: Optional[str]  # "receipt"|"recipe"|"text_query"|"pantry_command"|"unknown"

    # Outputs from agents — reducer lets multiple agents append independently
    agent_results: Annotated[list, add]

    # Final WhatsApp-ready response
    response: Optional[str]

    # Conversation context — last N turns for follow-up queries
    context: Optional[list]

    # Error state
    error: Optional[str]


# ── Classify ──────────────────────────────────────────────────────────────────

_CLASSIFY_PROMPT = (
    'Look at this image and reply with ONLY a JSON object, no markdown:\n'
    '{"type": "receipt"} if it is a shopping/grocery/restaurant receipt or invoice,\n'
    '{"type": "food_photo"} if it is a photo of prepared food or a dish,\n'
    '{"type": "other_image"} for anything else.'
)

_PANTRY_PREFIXES = (
    "added ", "used up", "running low", "we have", "bought ",
    "finished ", "out of", "low on",
)

_QUERY_PREFIXES = (
    "what", "how", "when", "where", "who", "which",
    "show", "tell", "list", "find", "total",
    "summarise", "summarize", "compare",
    "any", "are", "is", "do", "did", "have", "has",
)


def _classify_text(text: str) -> str:
    t = text.strip().lower()
    if not t:
        return "unknown"
    if any(t.startswith(p) for p in _PANTRY_PREFIXES):
        return "pantry_command"
    if t.endswith("?") or any(t.startswith(p) for p in _QUERY_PREFIXES):
        return "text_query"
    return "unknown"


def classify_node(state: HomlyState) -> dict:
    try:
        if state.get("image_bytes"):
            from services.llm_client import get_vision_completion
            img_bytes = state["image_bytes"]
            img_mime = state.get("image_mime") or "image/jpeg"
            # PDFs must be converted to JPEG before the vision model can classify them
            if img_mime == "application/pdf":
                from agents.receipt_agent import pdf_to_image_bytes
                img_bytes, img_mime = pdf_to_image_bytes(img_bytes)
            raw = get_vision_completion(
                _CLASSIFY_PROMPT,
                img_bytes,
                img_mime,
            )
            clean = raw.strip()
            if clean.startswith("```"):
                parts = clean.split("```")
                clean = parts[1]
                if clean.startswith("json"):
                    clean = clean[4:]
                clean = clean.strip()
            result = json.loads(clean)
            img_type = result.get("type", "other_image")
            mapping = {"receipt": "receipt", "food_photo": "recipe", "other_image": "unknown"}
            return {"message_type": mapping.get(img_type, "unknown")}

        if state.get("query"):
            return {"message_type": _classify_text(state["query"])}

        return {"message_type": "unknown"}

    except Exception as e:
        logger.error(f"[classify_node] error: {e}")
        return {"message_type": "unknown", "error": str(e)}


# ── Agent nodes ───────────────────────────────────────────────────────────────


def receipt_node(state: HomlyState) -> dict:
    from services.receipt_service import save_receipt
    result = save_receipt(
        image_bytes=state["image_bytes"],
        mime_type=state.get("image_mime") or "image/jpeg",
        household_id=state["household_id"],
        whatsapp_message_id=state.get("whatsapp_message_id"),
        sender_name=state.get("sender_name"),
        sender_phone=state.get("sender_phone"),
    )
    return {"agent_results": [{"agent": "receipt", "data": result}]}


def recipe_node(state: HomlyState) -> dict:
    from agents.recipe_agent import analyse_dish_with_pantry
    from supabase import create_client
    db = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    household_id = state["household_id"]
    result = analyse_dish_with_pantry(
        state["image_bytes"],
        state.get("image_mime") or "image/jpeg",
        household_id,
        db,
    )

    # Add missing/low-stock ingredients to the household shopping list
    added_count = 0
    for ing in result.get("ingredients") or []:
        if ing.get("pantry_staple") or ing.get("pantry_status") == "in_stock":
            continue
        canonical = (ing.get("canonical_name") or ing.get("name") or "").strip().lower()
        if not canonical:
            continue
        try:
            db.table("shopping_list").upsert(
                {
                    "household_id":   household_id,
                    "canonical_name": canonical,
                    "category":       ing.get("category", "other"),
                    "added_by":       "recipe",
                    "checked":        False,
                },
                on_conflict="household_id,canonical_name",
            ).execute()
            added_count += 1
        except Exception as e:
            logger.error(f"[recipe_node] shopping list upsert failed for {canonical}: {e}")

    result["items_added_to_shopping_list"] = added_count
    return {"agent_results": [{"agent": "recipe", "data": result}]}


def query_node(state: HomlyState) -> dict:
    from agents.router_agent import run_query
    qr = run_query(state.get("query", ""), state["household_id"], state.get("context"))
    return {"agent_results": [{"agent": "query", "data": {
        "response": qr.response,
        "sources": qr.sources,
        "handled": qr.handled,
    }}]}


def pantry_node(state: HomlyState) -> dict:
    from agents.router_agent import run_query
    qr = run_query(state.get("query", ""), state["household_id"], state.get("context"))
    return {"agent_results": [{"agent": "pantry", "data": {
        "response": qr.response,
        "sources": qr.sources,
        "handled": qr.handled,
    }}]}


# ── Synthesise ────────────────────────────────────────────────────────────────


def _format_recipe(data: dict) -> str:
    dish = data.get("dish") or "Unknown dish"
    confidence = data.get("confidence", "high")
    ingredients = data.get("ingredients") or []
    need_to_buy = data.get("need_to_buy") or []
    running_low = data.get("running_low") or []
    already_have = data.get("already_have") or []

    reply = ""
    if confidence == "low":
        reply += "⚠️ _Not sure about this dish — here's my best guess:_\n\n"
    reply += f"🍽️ *{dish}*\n\n"

    non_staples = [i for i in ingredients if not i.get("pantry_staple")]
    staples = [i for i in ingredients if i.get("pantry_staple")]
    staple_names = ", ".join(i["name"] for i in staples[:3])
    all_unknown = all(
        not i.get("pantry_status") or i.get("pantry_status") == "unknown"
        for i in non_staples
    )

    if not non_staples:
        reply += "✅ All ingredients are pantry staples — you likely have everything!"
    elif all_unknown:
        def fmt_qty(i):
            q = i.get("qty")
            u = i.get("unit", "")
            return f"({q}{' ' + u if u else ''})" if q else ""
        lines = "\n".join(f"- {i['name']} {fmt_qty(i)}".rstrip() for i in non_staples)
        reply += f"🛒 *Shopping list:*\n{lines}"
        if staple_names:
            reply += f"\n\n✅ Skipped pantry staples ({staple_names} etc.)"
        reply += "\n\n_Added to your Homly shopping list_"
        reply += "\n_Tip: tell me what you have (e.g. \"added rice\") to get smarter suggestions_"
    elif not need_to_buy and not running_low:
        reply += "✅ You have everything to make this!"
        if staple_names:
            reply += f"\n\n_Pantry staples ({staple_names} etc.) assumed present_"
    else:
        buy_items = need_to_buy + [f"{n} (running low)" for n in running_low]
        reply += "🛒 *Need to buy:*\n" + "\n".join(f"- {n}" for n in buy_items)
        if already_have:
            reply += "\n\n✅ *Already have:*\n" + ", ".join(already_have)
        if staple_names:
            reply += f"\n\n_Pantry staples ({staple_names} etc.) skipped_"

    return reply


def synthesise_node(state: HomlyState) -> dict:
    results = state.get("agent_results") or []
    if not results:
        return {"response": None}

    ar = results[0]
    agent = ar.get("agent")
    data = ar.get("data", {})

    if agent in ("query", "pantry"):
        response = data.get("response") or "I couldn't process that query."
    elif agent == "receipt":
        if data.get("status") == "duplicate":
            return {"response": None}
        vendor = data.get("vendor") or "unknown"
        total = data.get("total")
        if data.get("flagged"):
            response = (
                f"Receipt captured but needs a manual check.\n"
                f"Vendor: {vendor}, Total: {f'SGD {total}' if total else 'unreadable'}"
            )
        else:
            response = f"✅ {vendor} — SGD {total}"
    elif agent == "recipe":
        response = _format_recipe(data)
    else:
        response = None

    return {"response": response}


# ── Graph ─────────────────────────────────────────────────────────────────────


def route_by_type(state: HomlyState) -> str:
    return state.get("message_type") or "unknown"


_builder = StateGraph(HomlyState)
_builder.add_node("classify", classify_node)
_builder.add_node("receipt", receipt_node)
_builder.add_node("recipe", recipe_node)
_builder.add_node("query", query_node)
_builder.add_node("pantry", pantry_node)
_builder.add_node("synthesise", synthesise_node)

_builder.set_entry_point("classify")
_builder.add_conditional_edges("classify", route_by_type, {
    "receipt": "receipt",
    "recipe": "recipe",
    "text_query": "query",
    "pantry_command": "pantry",
    "unknown": END,
})
_builder.add_edge("receipt", "synthesise")
_builder.add_edge("recipe", "synthesise")
_builder.add_edge("query", "synthesise")
_builder.add_edge("pantry", "synthesise")
_builder.add_edge("synthesise", END)

# Stateless graph — used for API calls that don't need memory
graph = _builder.compile()

# Cache for the memory-backed compiled graph
_memory_graph = None


def get_graph(with_memory: bool = False):
    """Return the compiled graph.

    with_memory=True compiles with a PostgresSaver checkpointer so each
    WhatsApp group thread accumulates conversation history.  Falls back to
    the stateless graph if SUPABASE_DB_URL is not set.
    """
    global _memory_graph

    if not with_memory:
        return graph

    if _memory_graph is not None:
        return _memory_graph

    db_url = os.getenv("SUPABASE_DB_URL")
    if not db_url:
        logger.warning(
            "[homly_graph] SUPABASE_DB_URL not set — falling back to stateless graph"
        )
        return graph

    try:
        import psycopg
        from langgraph.checkpoint.postgres import PostgresSaver

        conn = psycopg.connect(db_url, autocommit=True)
        checkpointer = PostgresSaver(conn)
        checkpointer.setup()
        _memory_graph = _builder.compile(checkpointer=checkpointer)
        logger.info("[homly_graph] PostgresSaver checkpointer initialised")
        return _memory_graph
    except Exception as e:
        logger.warning(
            f"[homly_graph] PostgresSaver setup failed: {e} — falling back to stateless"
        )
        return graph
