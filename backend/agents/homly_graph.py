import json
import logging
import os
from datetime import datetime, timezone as tz
from operator import add
from typing import Annotated, Optional, TypedDict

from langgraph.graph import END, StateGraph
from langgraph.types import interrupt

logger = logging.getLogger(__name__)

# ── State ─────────────────────────────────────────────────────────────────────

_GROCERY_VENDORS = frozenset({
    "fairprice", "cold storage", "giant", "sheng siong", "redmart",
    "mustafa", "prime supermarket", "market place", "marketplace",
    "jasons", "jason's", "little farms",
})

_NON_PANTRY_KEYWORDS = ("plastic bag", "carrier bag", "voucher", "gift card", "receipt")


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
    message_type: Optional[str]  # "receipt"|"recipe"|"text_query"|"pantry_command"|"fridge_scan"|"unknown"

    # Outputs from agents — reducer lets multiple agents append independently
    agent_results: Annotated[list, add]

    # Final WhatsApp-ready response
    response: Optional[str]

    # Conversation context — last N turns for follow-up queries
    context: Optional[list]

    # Error state
    error: Optional[str]

    # Phase 3 — pantry confirmation flow
    receipt_id: Optional[str]
    receipt_category: Optional[str]       # "grocery" | "non_grocery"
    pantry_candidates: Optional[list]     # items extracted from receipt for pantry
    pantry_confirmation_pending: Optional[bool]
    confirmed_items: Optional[list]       # items the user approved


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

_FRIDGE_SCAN_KEYWORDS = (
    "fridge", "pantry", "shelf", "stock", "groceries",
    "what do we have", "what's in", "inventory", "cupboard",
)

_QUERY_PREFIXES = (
    "what", "how", "when", "where", "who", "which",
    "show", "tell", "list", "find", "total",
    "summarise", "summarize", "compare",
    "any", "are", "is", "do", "did", "have", "has",
)

# Exact phrases the household member sends to confirm the weekly payout
_PAYMENT_EXACT = frozenset({
    "paid", "reimbursed", "payment made", "payment done", "all paid",
    "paid up", "settled", "yes paid", "done paying", "payment settled",
})


def _classify_text(text: str) -> str:
    t = text.strip().lower().rstrip("!.✓ ")
    if not t:
        return "unknown"
    if t in _PAYMENT_EXACT:
        return "payment_confirmation"
    if any(t.startswith(p) for p in _PANTRY_PREFIXES):
        return "pantry_command"
    if t.endswith("?") or any(t.startswith(p) for p in _QUERY_PREFIXES):
        return "text_query"
    return "unknown"


def classify_node(state: HomlyState) -> dict:
    try:
        if state.get("image_bytes"):
            # Caption-based fridge scan detection takes priority over vision classifier
            caption = (state.get("query") or "").lower()
            if any(kw in caption for kw in _FRIDGE_SCAN_KEYWORDS):
                return {"message_type": "fridge_scan"}

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
    return {
        "agent_results": [{"agent": "receipt", "data": result}],
        "receipt_id": result.get("receipt_id"),
    }


def recipe_node(state: HomlyState) -> dict:
    from agents.recipe_agent import analyse_dish_with_pantry
    from services.shopping_list import add_auto_item
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
        if add_auto_item(db, household_id, canonical, category=ing.get("category", "other"), added_by="recipe"):
            added_count += 1

    result["items_added_to_shopping_list"] = added_count
    return {"agent_results": [{"agent": "recipe", "data": result}]}


def query_node(state: HomlyState) -> dict:
    from agents.router_agent import run_query
    qr = run_query(state.get("query", ""), state["household_id"], state.get("context"),
                   sender_name=state.get("sender_name"), sender_phone=state.get("sender_phone"))
    return {"agent_results": [{"agent": "query", "data": {
        "response": qr.response,
        "sources": qr.sources,
        "handled": qr.handled,
    }}]}


def pantry_node(state: HomlyState) -> dict:
    from agents.router_agent import run_query
    qr = run_query(state.get("query", ""), state["household_id"], state.get("context"),
                   sender_name=state.get("sender_name"), sender_phone=state.get("sender_phone"))
    return {"agent_results": [{"agent": "pantry", "data": {
        "response": qr.response,
        "sources": qr.sources,
        "handled": qr.handled,
    }}]}


# ── Phase 3 — Pantry confirmation nodes ──────────────────────────────────────


def classify_receipt_type_node(state: HomlyState) -> dict:
    results = state.get("agent_results") or []
    if not results:
        return {"receipt_category": "non_grocery"}

    data = results[0].get("data", {})
    if data.get("status") in ("duplicate", "error"):
        return {"receipt_category": "non_grocery"}

    vendor = (data.get("vendor") or "").lower()
    if any(g in vendor for g in _GROCERY_VENDORS):
        return {"receipt_category": "grocery"}

    items = data.get("items") or []
    if not items:
        return {"receipt_category": "non_grocery"}

    grocery_total = sum(
        float(i.get("line_total") or 0)
        for i in items
        if (i.get("category") or "").lower() == "groceries"
    )
    grand_total = sum(float(i.get("line_total") or 0) for i in items)

    if grand_total > 0 and (grocery_total / grand_total) > 0.5:
        return {"receipt_category": "grocery"}

    return {"receipt_category": "non_grocery"}


def extract_pantry_candidates_node(state: HomlyState) -> dict:
    results = state.get("agent_results") or []
    data = results[0].get("data", {}) if results else {}
    items = data.get("items") or []

    candidates = []
    for item in items:
        category = (item.get("category") or "").lower()
        if category == "food & beverage":
            continue
        line_total = float(item.get("line_total") or 0)
        if line_total < 0.50:
            continue
        canonical = (item.get("canonical_name") or item.get("name") or "").strip().lower()
        if not canonical:
            continue
        if any(kw in canonical for kw in _NON_PANTRY_KEYWORDS):
            continue
        candidates.append({
            "canonical_name": canonical,
            "category":       item.get("category"),
            "unit_price":     item.get("unit_price"),
            "qty":            item.get("qty"),
            "unit":           item.get("unit"),
        })

    return {"pantry_candidates": candidates}


def send_pantry_confirmation_node(state: HomlyState) -> dict:
    from services.whatsapp_client import send_text_sync

    candidates = state.get("pantry_candidates") or []
    receipt_category = state.get("receipt_category")
    data = (state.get("agent_results") or [{}])[0].get("data", {})

    if receipt_category == "fridge_scan":
        header = f"📦 *Found {len(candidates)} item{'s' if len(candidates) != 1 else ''} in your fridge/pantry:*"
        lines = "\n".join(
            f"{i + 1}. {'⚠️ ' if c.get('confidence') == 'low' else ''}{c['canonical_name'].title()}"
            + (f" ({c['quantity']} {c['unit']})" if c.get("quantity") and c.get("unit") else
               f" ({c['quantity']})" if c.get("quantity") else "")
            for i, c in enumerate(candidates)
        )
    else:
        vendor = data.get("vendor") or "grocery store"
        total = data.get("total")
        total_str = f"SGD {total}" if total else ""
        header = f"🛒 *Grocery receipt saved* — {vendor}{', ' + total_str if total_str else ''}"
        lines = "\n".join(
            f"{i + 1}. {c['canonical_name'].title()}"
            + (f" ({c.get('qty')} {c.get('unit')})" if c.get("qty") and c.get("unit") else
               f" ({c.get('qty')})" if c.get("qty") else "")
            for i, c in enumerate(candidates)
        )
    footer = (
        "\nReply *yes* to add all, *no* to skip, "
        "or list numbers to add specific items (e.g. *1,3,5*)"
    )
    if receipt_category == "fridge_scan":
        message = f"{header}\n\nAdd to pantry?\n\n{lines}{footer}"
    else:
        message = f"{header}\n\nAdd these items to your pantry?\n\n{lines}{footer}"

    group_jid = state.get("group_jid")
    if group_jid:
        send_text_sync(group_jid, message)

    interrupt({"waiting_for": "pantry_confirmation", "group_jid": group_jid})

    return {"pantry_confirmation_pending": False}


def resume_from_confirmation_node(state: HomlyState) -> dict:
    candidates = state.get("pantry_candidates") or []
    reply = (state.get("query") or "").strip().lower()

    if not reply or reply in ("yes", "y", "ok", "yeah", "sure", "yep", "yup"):
        return {"confirmed_items": list(candidates)}

    if reply in ("no", "n", "nope", "skip", "nah"):
        return {"confirmed_items": []}

    # Comma-separated numbers
    if all(part.strip().isdigit() for part in reply.split(",") if part.strip()):
        indices = [int(p.strip()) - 1 for p in reply.split(",") if p.strip().isdigit()]
        selected = [candidates[i] for i in indices if 0 <= i < len(candidates)]
        return {"confirmed_items": selected}

    # Fuzzy name match
    tokens = [t.strip() for t in reply.split(",")]
    selected = [
        c for c in candidates
        if any(t in c["canonical_name"] or c["canonical_name"] in t for t in tokens)
    ]
    if selected:
        return {"confirmed_items": selected}

    # Unrecognised — bias toward adding all
    return {"confirmed_items": list(candidates)}


def update_pantry_node(state: HomlyState) -> dict:
    from supabase import create_client
    db = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

    confirmed = state.get("confirmed_items") or []
    if not confirmed:
        return {"agent_results": [{"agent": "pantry_update", "data": {"updated": [], "count": 0}}]}

    household_id = state["household_id"]
    now = datetime.now(tz.utc).isoformat()
    rows = [
        {
            "household_id":   household_id,
            "canonical_name": item["canonical_name"],
            "category":       item.get("category"),
            "status":         "in_stock",
            "quantity":       item.get("qty") or item.get("quantity"),
            "unit":           item.get("unit"),
            "added_by":       item.get("source", "receipt"),
            "last_updated":   now,
        }
        for item in confirmed
    ]
    try:
        db.table("pantry_items").upsert(rows, on_conflict="household_id,canonical_name").execute()
    except Exception as e:
        logger.error(f"[update_pantry_node] upsert failed: {e}")

    names = [item["canonical_name"] for item in confirmed]
    return {"agent_results": [{"agent": "pantry_update", "data": {"updated": names, "count": len(names)}}]}


def confirm_to_user_node(state: HomlyState) -> dict:
    results = state.get("agent_results") or []
    pantry_result = next((r for r in results if r.get("agent") == "pantry_update"), None)
    if not pantry_result:
        return {"response": "👍 Pantry not updated"}

    count = pantry_result["data"].get("count", 0)
    names = pantry_result["data"].get("updated", [])
    if count == 0:
        return {"response": "👍 Pantry not updated"}

    name_list = ", ".join(n.title() for n in names[:6])
    if len(names) > 6:
        name_list += f" and {len(names) - 6} more"
    return {"response": f"✅ Added {count} item{'s' if count != 1 else ''} to your pantry: {name_list}"}


# ── Fridge scan node ─────────────────────────────────────────────────────────


def fridge_scan_node(state: HomlyState) -> dict:
    from agents.fridge_agent import scan_fridge
    try:
        result = scan_fridge(state["image_bytes"], state.get("image_mime") or "image/jpeg")
        items = result.get("items") or []

        candidates = [
            {
                "canonical_name": item["canonical_name"],
                "category": item.get("category"),
                "quantity": item.get("quantity"),
                "unit": item.get("unit"),
                "confidence": item.get("confidence", "high"),
                "source": "fridge_scan",
            }
            for item in items
        ]

        return {
            "agent_results": [{"agent": "fridge_scan", "data": result}],
            "pantry_candidates": candidates,
            "receipt_category": "fridge_scan",
        }
    except Exception as e:
        logger.error(f"[fridge_scan_node] error: {e}")
        return {"error": str(e), "pantry_candidates": []}


def route_after_fridge_scan(state: HomlyState) -> str:
    candidates = state.get("pantry_candidates") or []
    if not candidates:
        return "synthesise"
    return "send_pantry_confirmation"


# ── Payment confirmation ──────────────────────────────────────────────────────


def payment_confirm_node(state: HomlyState) -> dict:
    """Mark the most recently completed expense cycle as reimbursed."""
    import os
    from datetime import date, timedelta
    from supabase import create_client as _create

    db = _create(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    household_id = state["household_id"]

    # Get summary_day so we know when each cycle starts (0=Mon…6=Sun, Python weekday)
    try:
        s = db.table("settings").select("summary_day").eq("household_id", household_id).execute()
        summary_day = (s.data or [{}])[0].get("summary_day", 5)  # default Saturday
    except Exception as e:
        logger.error(f"[payment_confirm_node] settings fetch: {e}")
        return {"response": "❌ Something went wrong. Please try again."}

    # The completed cycle: from (current_week_start - 7d) to (current_week_start - 1d).
    # current_week_start = most recent date whose weekday == summary_day (0=Mon, 6=Sun).
    today = date.today()
    days_since = (today.weekday() - summary_day) % 7
    current_week_start = today if days_since == 0 else today - timedelta(days=days_since)
    cycle_start = current_week_start - timedelta(days=7)
    cycle_end   = current_week_start - timedelta(days=1)

    def _fmt(d: date) -> str:
        return f"{d.day} {d.strftime('%b')}"

    period = f"{_fmt(cycle_start)} – {_fmt(cycle_end)}"

    # Fetch total reimbursable for the completed cycle
    try:
        r = (
            db.table("receipts")
            .select("total, reimbursable")
            .eq("household_id", household_id)
            .eq("deleted", False)
            .gte("date", cycle_start.isoformat())
            .lte("date", cycle_end.isoformat())
            .execute()
        )
        receipts = r.data or []
    except Exception as e:
        logger.error(f"[payment_confirm_node] receipts fetch: {e}")
        return {"response": "❌ Something went wrong fetching receipts. Please try again."}

    if not receipts:
        return {"response": f"📋 No receipts found for {period}.\n\nNothing to mark as paid."}

    total = round(sum((rec.get("total") or 0) for rec in receipts if rec.get("reimbursable", True)), 2)

    # Check for duplicate confirmation
    iso = cycle_start.isocalendar()
    try:
        existing = (
            db.table("reimbursements")
            .select("amount")
            .eq("household_id", household_id)
            .eq("year", iso.year)
            .eq("week_number", iso.week)
            .execute()
        )
        if existing.data:
            already = sum(r["amount"] for r in existing.data)
            return {"response": f"✅ Already recorded — {period} was marked as paid (SGD {already:.2f})."}
    except Exception as e:
        logger.error(f"[payment_confirm_node] duplicate check: {e}")

    # Record the reimbursement
    try:
        db.table("reimbursements").insert({
            "household_id": household_id,
            "year":         iso.year,
            "week_number":  iso.week,
            "amount":       total,
            "note":         f"{period} reimbursed via WhatsApp",
            "created_by":   None,
        }).execute()
    except Exception as e:
        logger.error(f"[payment_confirm_node] insert: {e}")
        return {"response": "❌ Failed to record payment. Please try again or use the app."}

    return {
        "response": (
            f"✅ *Payment confirmed!*\n\n"
            f"SGD {total:.2f} marked as reimbursed for {period}.\n\n"
            f"New cycle starts today — fresh slate! 🎉"
        )
    }


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

    # Pantry confirmation path already set response in confirm_to_user_node
    if state.get("confirmed_items") is not None:
        return {}

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
    elif agent == "fridge_scan":
        items = data.get("items") or []
        scan_confidence = data.get("scan_confidence", "high")
        notes = data.get("notes")
        if not items or (scan_confidence == "low" and not items):
            response = (
                "📷 Could not identify food items clearly. "
                "Try a well-lit photo from straight on, or add a caption like \"fridge 🧊\""
            )
        else:
            # Items were found but user declined — confirm_to_user_node handles the success path
            response = "👍 Pantry not updated"
        if notes and scan_confidence == "low" and not items:
            response = (
                "📷 Could not identify food items clearly. "
                "Try a well-lit photo from straight on, or add a caption like \"fridge 🧊\""
            )
    else:
        response = None

    return {"response": response}


# ── Graph ─────────────────────────────────────────────────────────────────────


def route_by_type(state: HomlyState) -> str:
    return state.get("message_type") or "unknown"


def route_after_receipt_classify(state: HomlyState) -> str:
    if state.get("receipt_category") != "grocery":
        return "synthesise"
    candidates = state.get("pantry_candidates")
    if not candidates:
        return "synthesise"
    return "send_pantry_confirmation"


_builder = StateGraph(HomlyState)
_builder.add_node("classify", classify_node)
_builder.add_node("receipt", receipt_node)
_builder.add_node("recipe", recipe_node)
_builder.add_node("query", query_node)
_builder.add_node("pantry", pantry_node)
_builder.add_node("payment_confirm", payment_confirm_node)
_builder.add_node("synthesise", synthesise_node)

# Phase 3 nodes
_builder.add_node("fridge_scan", fridge_scan_node)
_builder.add_node("classify_receipt_type", classify_receipt_type_node)
_builder.add_node("extract_pantry_candidates", extract_pantry_candidates_node)
_builder.add_node("send_pantry_confirmation", send_pantry_confirmation_node)
_builder.add_node("resume_from_confirmation", resume_from_confirmation_node)
_builder.add_node("update_pantry", update_pantry_node)
_builder.add_node("confirm_to_user", confirm_to_user_node)

_builder.set_entry_point("classify")
_builder.add_conditional_edges("classify", route_by_type, {
    "receipt": "receipt",
    "recipe": "recipe",
    "text_query": "query",
    "pantry_command": "pantry",
    "fridge_scan": "fridge_scan",
    "payment_confirmation": "payment_confirm",
    "unknown": END,
})

# Receipt path: receipt → classify_receipt_type → extract_pantry_candidates → conditional
_builder.add_edge("receipt", "classify_receipt_type")
_builder.add_edge("classify_receipt_type", "extract_pantry_candidates")
_builder.add_conditional_edges(
    "extract_pantry_candidates",
    route_after_receipt_classify,
    {
        "synthesise": "synthesise",
        "send_pantry_confirmation": "send_pantry_confirmation",
    },
)

# Pantry confirmation path (resumes after interrupt)
_builder.add_edge("send_pantry_confirmation", "resume_from_confirmation")
_builder.add_edge("resume_from_confirmation", "update_pantry")
_builder.add_edge("update_pantry", "confirm_to_user")
_builder.add_edge("confirm_to_user", "synthesise")

_builder.add_conditional_edges("fridge_scan", route_after_fridge_scan, {
    "synthesise": "synthesise",
    "send_pantry_confirmation": "send_pantry_confirmation",
})

_builder.add_edge("recipe", "synthesise")
_builder.add_edge("query", "synthesise")
_builder.add_edge("pantry", "synthesise")
_builder.add_edge("payment_confirm", END)
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
