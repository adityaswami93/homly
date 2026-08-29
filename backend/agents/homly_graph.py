import json
import logging
import os
import re
from datetime import datetime, timezone as tz
from typing import Annotated, Optional, TypedDict

from langgraph.graph import END, StateGraph

from services import bot_profile

logger = logging.getLogger(__name__)

# ── State ─────────────────────────────────────────────────────────────────────

_GROCERY_VENDORS = frozenset({
    "fairprice", "cold storage", "giant", "sheng siong", "redmart",
    "mustafa", "prime supermarket", "market place", "marketplace",
    "jasons", "jason's", "little farms",
})

_NON_PANTRY_KEYWORDS = ("plastic bag", "carrier bag", "voucher", "gift card", "receipt")


def _merge_agent_results(existing: list | None, new: list | None) -> list:
    """Append within a run; `None` starts a fresh run.

    `agent_results` used a plain `operator.add`, which is right inside one run
    (several agent nodes appending independently) but wrong across runs: with
    get_graph(with_memory=True) the state is checkpointed per group_jid, so
    results accumulated forever and downstream nodes reading `results[0]` —
    synthesise_node, classify_receipt_type_node — would keep re-reading the
    first result this group ever produced instead of the current one.

    classify_node, the entry point, now returns None here to clear the slate.
    """
    if new is None:
        return []
    return (existing or []) + list(new)


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

    # Was this message aimed at the bot? The WhatsApp client sets these two from
    # things only it can see — an @mention of its own JID, and a reply to one of
    # its own messages. classify_node adds a third signal (the text using the
    # household's configured bot_name) and folds all three into `addressed`.
    was_mentioned: Optional[bool]
    is_reply_to_bot: Optional[bool]
    addressed: Optional[bool]

    # Classification result
    message_type: Optional[str]  # "receipt"|"recipe"|"text_query"|"pantry_command"|"fridge_scan"|"other_image"|"unknown"

    # Whether the household's engagement mode lets the assistant answer this
    # one at all (services/bot_profile.py's should_engage). Receipts, recipes,
    # and fridge scans are explicit actions and always pass (should_engage's
    # _ALWAYS_ENGAGE) — but an unrecognized photo ("other_image") is exactly
    # as much "chatter to stay out of" as an unaddressed text message is, and
    # is gated the same way.
    engage: Optional[bool]

    # Outputs from agents — reducer lets multiple agents append independently
    # within a run, and `None` resets it between runs (see _merge_agent_results).
    agent_results: Annotated[list, _merge_agent_results]

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

# Exact phrases the household member sends to confirm the weekly payout.
# Matched before the LLM classifier runs — deterministic and cheap, and
# money-moving confirmations shouldn't ride on a model call.
_PAYMENT_EXACT = frozenset({
    "paid", "reimbursed", "payment made", "payment done", "all paid",
    "paid up", "settled", "yes paid", "done paying", "payment settled",
})

# The message_type values _classify_text (LLM or keyword) may return. Kept
# separate from the full HomlyState.message_type union — pantry_confirmation,
# receipt, recipe, and fridge_scan are decided elsewhere in classify_node,
# never by this text classifier.
_TEXT_MESSAGE_TYPES = frozenset({"payment_confirmation", "pantry_command", "text_query", "unknown"})

_TEXT_CLASSIFY_SYSTEM = (
    "You classify a single WhatsApp message sent into a household's shared group chat. "
    'Reply with ONLY a JSON object, no markdown: {"type": "<value>"} where <value> is exactly '
    "one of:\n"
    '  "pantry_command" — reporting on pantry/grocery stock, e.g. "we\'re out of milk", '
    '"added rice", "running low on eggs", "bought detergent"\n'
    '  "text_query" — a genuine question or request for information/action about the '
    "household's expenses, insurance, pantry, savings, budgets, reminders, or chores, e.g. "
    '"how much did we spend on groceries this month?", "remind the helper to mop Tuesday", '
    '"when does the car insurance renew?"\n'
    '  "unknown" — anything else: small talk, chatter between household members, replies to '
    "each other, statements with no request or report in them\n\n"
    "Classify only what the message itself says — don't guess at context you don't have."
)
_TEXT_CLASSIFY_TIMEOUT_SECONDS = 6.0


def _parse_json_object(raw: str) -> dict:
    clean = (raw or "").strip()
    if clean.startswith("```"):
        parts = clean.split("```")
        clean = parts[1]
        if clean.startswith("json"):
            clean = clean[4:]
        clean = clean.strip()
    return json.loads(clean)


def _classify_text_llm(text: str) -> Optional[str]:
    """LLM classification of a text message into one of _TEXT_MESSAGE_TYPES.

    Returns None on any failure (timeout, malformed response, an unrecognized
    type) so the caller falls back to the keyword heuristic instead of
    blocking message handling on a single model call — this runs on every
    WhatsApp text message, so it must never become the reason nothing gets
    classified at all.
    """
    try:
        from services.llm_client import get_completion
        raw = get_completion(
            f'Message: "{text}"',
            system=_TEXT_CLASSIFY_SYSTEM,
            timeout=_TEXT_CLASSIFY_TIMEOUT_SECONDS,
        )
        result = _parse_json_object(raw)
        message_type = result.get("type")
        if message_type in _TEXT_MESSAGE_TYPES:
            return message_type
        logger.warning(f"[_classify_text_llm] unrecognized type from model: {message_type!r}")
        return None
    except Exception as e:
        logger.warning(f"[_classify_text_llm] falling back to keyword classifier: {e}")
        return None

# WhatsApp renders an @mention with the contact's display name, but the raw
# message text carries it as "@<phone_number>" — strip any leading run of
# these before classifying, or a message like "@6591234567 what's in pantry"
# fails every prefix/suffix heuristic below and falls through to "unknown".
_MENTION_PREFIX_RE = re.compile(r"^(?:@\S+\s*)+")


def _strip_mention_prefix(text: str) -> str:
    return _MENTION_PREFIX_RE.sub("", text or "").strip()


def _classify_text_keywords(t: str) -> str:
    """Prefix/suffix keyword fallback — used when the LLM classifier is
    unavailable or returns something we don't recognize. `t` is already
    stripped/lowered/trimmed of trailing punctuation by the caller.
    """
    if any(t.startswith(p) for p in _PANTRY_PREFIXES):
        return "pantry_command"
    if t.endswith("?") or any(t.startswith(p) for p in _QUERY_PREFIXES):
        return "text_query"
    return "unknown"


def _classify_text(text: str) -> str:
    t = text.strip().lower().rstrip("!.✓ ")
    if not t:
        return "unknown"
    if t in _PAYMENT_EXACT:
        return "payment_confirmation"
    return _classify_text_llm(text) or _classify_text_keywords(t)


_CONFIRM_YES = frozenset({"yes", "y", "ok", "okay", "yeah", "sure", "yep", "yup", "all"})
_CONFIRM_NO  = frozenset({"no", "n", "nope", "skip", "nah", "none"})


def _load_pending(state: "HomlyState") -> Optional[dict]:
    """The live pantry prompt for this group, if any."""
    group_jid = state.get("group_jid")
    if not group_jid:
        return None
    try:
        from services.pantry_confirmations import get_pending
        return get_pending(state["household_id"], group_jid)
    except Exception as e:
        logger.error(f"[_load_pending] lookup failed: {e}")
        return None


def _looks_like_confirmation(reply: str, candidates: list) -> bool:
    """True if `reply` reads as an answer to "add these items to your pantry?".

    Deliberately narrow: a pending prompt must not swallow an unrelated
    question someone happens to send while it is open.
    """
    r = (reply or "").strip().lower().rstrip("!.✓ ")
    if not r:
        return False
    if r in _CONFIRM_YES or r in _CONFIRM_NO:
        return True
    parts = [p.strip() for p in r.split(",") if p.strip()]
    if parts and all(p.isdigit() for p in parts):
        return True
    # Naming the items back is an answer ("paneer" / "paneer, tomato"), but
    # match whole comma-separated parts only. A loose substring test lets a
    # candidate like "tea" fire on "what's the weather" and hijack the message.
    names = {(c.get("canonical_name") or "").lower() for c in candidates if c.get("canonical_name")}
    return any(p in names for p in parts)


# Fields that describe the message currently being handled, not the group's
# standing state. classify_node is the entry point, so clearing them here is
# what stops one run's leftovers from being read as this run's — the graph is
# checkpointed per group_jid, and `confirmed_items` in particular short-circuits
# synthesise_node, which would silently swallow the next reply.
_RUN_RESET = {
    "agent_results": None,          # _merge_agent_results treats None as "fresh run"
    "receipt_id": None,
    "receipt_category": None,
    "pantry_candidates": None,
    "pantry_confirmation_pending": None,
    "confirmed_items": None,
    "response": None,
    "error": None,
}


def classify_node(state: HomlyState) -> dict:
    try:
        if state.get("image_bytes"):
            # A photo's caption carries the same addressing signals a text message's
            # body does — an @mention or the bot's name said in the caption — so an
            # unrecognized photo can be gated exactly like unaddressed chatter is,
            # instead of always forcing an unsolicited reply.
            raw_caption = state.get("query") or ""
            profile = bot_profile.get_profile(state["household_id"])
            addressed = bool(
                state.get("was_mentioned")
                or state.get("is_reply_to_bot")
                or bot_profile.mentions_name(raw_caption, profile.name)
            )

            def _classified(message_type: str) -> dict:
                # should_engage() is the single source of truth for this decision
                # (see services/bot_profile.py) — receipt/recipe/fridge_scan are in
                # its _ALWAYS_ENGAGE set so this is still unconditionally True for
                # them, exactly as before; only "other_image" newly falls through
                # to the addressed/engagement-mode checks a text message would get.
                return {
                    **_RUN_RESET,
                    "message_type": message_type,
                    "addressed": addressed,
                    "engage": bot_profile.should_engage(message_type, profile, addressed),
                }

            # Caption-based fridge scan detection takes priority over vision classifier
            caption = raw_caption.lower()
            if any(kw in caption for kw in _FRIDGE_SCAN_KEYWORDS):
                return _classified("fridge_scan")

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
            # "other_image" is its own message_type (not folded into "unknown") —
            # it must never reach the chat orchestrator, which has no way to see
            # the photo itself, only whatever caption text (if any) came with it.
            # See route_by_type / unsupported_image_node below.
            mapping = {"receipt": "receipt", "food_photo": "recipe", "other_image": "other_image"}
            return _classified(mapping.get(img_type, "other_image"))

        if state.get("query"):
            # _strip_mention_prefix drops the "@6591234567 " that WhatsApp leaves
            # in the raw text, so classification sees the actual words — but the
            # fact that the bot *was* mentioned is signal we still need, and the
            # client passes it separately for exactly that reason.
            raw_query = state["query"]
            query = _strip_mention_prefix(raw_query)
            profile = bot_profile.get_profile(state["household_id"])

            # Name check runs against the *raw* text: someone who types
            # "@Homly what's for dinner" by hand produces no real WhatsApp
            # mention (so was_mentioned is false), and _strip_mention_prefix
            # has already eaten the "@Homly" by the time `query` exists.
            addressed = bool(
                state.get("was_mentioned")
                or state.get("is_reply_to_bot")
                or bot_profile.mentions_name(raw_query, profile.name)
            )

            pending = _load_pending(state)
            if pending and _looks_like_confirmation(
                query, pending.get("candidates") or []
            ):
                message_type = "pantry_confirmation"
            else:
                message_type = _classify_text(query)

            return {
                **_RUN_RESET,
                "message_type": message_type,
                "query": query,
                "addressed": addressed,
                "engage": bot_profile.should_engage(message_type, profile, addressed),
            }

        # Neither text nor image — nothing to answer, and nothing to hand the
        # assistant. Explicitly not engaging (see the note above on stale state).
        return {**_RUN_RESET, "message_type": "unknown", "engage": False}

    except Exception as e:
        logger.error(f"[classify_node] error: {e}")
        return {**_RUN_RESET, "message_type": "unknown", "engage": False, "error": str(e)}


# ── Agent nodes ───────────────────────────────────────────────────────────────


def unsupported_image_node(state: HomlyState) -> dict:
    """A photo the vision classifier couldn't place as a receipt, dish, or
    fridge/pantry scan, and that the household engaged with anyway (addressed,
    or `always` mode). Answers honestly instead of handing it to the chat
    orchestrator — run_query() only ever sees the caption text, never the
    image itself, so pretending to have looked at the photo would just be a
    confident-sounding guess about a picture nobody actually read.
    """
    return {
        "response": (
            "📷 I can't tell what this photo is for — I can help with receipts, "
            "fridge/pantry photos, and dishes you want ingredient help with."
        )
    }


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
    from services.pantry_confirmations import save_pending

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

    # Record the prompt before sending it, so a reply that arrives while this
    # request is still in flight still finds it.
    saved = save_pending(
        household_id=state["household_id"],
        group_jid=group_jid,
        candidates=candidates,
        source="fridge_scan" if receipt_category == "fridge_scan" else "receipt",
        receipt_id=state.get("receipt_id"),
    )

    if group_jid:
        send_text_sync(group_jid, message)

    if group_jid and not saved:
        # We asked the group a question we have nowhere to record, so their
        # reply will not be actionable. Loud, because it is silent in the chat.
        logger.error(
            f"[send_pantry_confirmation_node] could not persist pending prompt "
            f"for {group_jid} — the group's pantry reply will be ignored"
        )

    # The run ends here. The reply arrives as its own WhatsApp message and is
    # routed back in through classify_node -> resume_from_confirmation.
    return {"pantry_confirmation_pending": saved}


def resume_from_confirmation_node(state: HomlyState) -> dict:
    candidates = state.get("pantry_candidates") or []
    pending = _load_pending(state)
    if not candidates and pending:
        candidates = pending.get("candidates") or []

    # Answered (either way) — retire the prompt so a later "yes" cannot
    # re-add the same items.
    if pending:
        from services.pantry_confirmations import clear_pending
        clear_pending(state["household_id"], state.get("group_jid"))

    reply = (state.get("query") or "").strip().lower()

    if not reply or reply in _CONFIRM_YES:
        return {"pantry_candidates": candidates, "confirmed_items": list(candidates)}

    if reply in _CONFIRM_NO:
        return {"pantry_candidates": candidates, "confirmed_items": []}

    # Comma-separated numbers
    if all(part.strip().isdigit() for part in reply.split(",") if part.strip()):
        indices = [int(p.strip()) - 1 for p in reply.split(",") if p.strip().isdigit()]
        selected = [candidates[i] for i in indices if 0 <= i < len(candidates)]
        return {"pantry_candidates": candidates, "confirmed_items": selected}

    # Fuzzy name match
    tokens = [t.strip() for t in reply.split(",")]
    selected = [
        c for c in candidates
        if any(t in c["canonical_name"] or c["canonical_name"] in t for t in tokens)
    ]
    if selected:
        return {"pantry_candidates": candidates, "confirmed_items": selected}

    # Unrecognised — bias toward adding all
    return {"pantry_candidates": candidates, "confirmed_items": list(candidates)}


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
    from services.reimbursement import mark_receipts_reimbursed

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

    # Fetch the cycle's receipts, including reimbursement_id so
    # mark_receipts_reimbursed can tell which ones are already paid.
    try:
        r = (
            db.table("receipts")
            .select("id, date, total, reimbursable, reimbursement_id")
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

    try:
        result = mark_receipts_reimbursed(
            db, household_id, receipts,
            note=f"{period} reimbursed via WhatsApp", created_by=None,
        )
    except Exception as e:
        logger.error(f"[payment_confirm_node] mark reimbursed: {e}")
        return {"response": "❌ Failed to record payment. Please try again or use the app."}

    if not result:
        return {"response": f"✅ Already recorded — {period} was already marked as paid."}

    return {
        "response": (
            f"✅ *Payment confirmed!*\n\n"
            f"SGD {result['amount']:.2f} marked as reimbursed for {period}.\n\n"
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
    message_type = state.get("message_type") or "unknown"

    # classify_node sets `engage` on every path now (text and image alike) via
    # should_engage() — a `False` here means the household's engagement mode
    # says stay out of this one, whether it's unaddressed chatter or a random
    # photo nobody asked the bot about.
    if state.get("engage") is False:
        return "silent"

    # Everything else the household has opted to engage with goes to the
    # assistant, including text the keyword classifier couldn't place. That
    # last case is the whole point: "morning!", "thanks!", "lol true" used to
    # route straight to END and the group got silence from something that
    # presents itself as an assistant. The orchestrator cannot go silent —
    # force_finalize_node guarantees a text answer — so handing it the message
    # is what makes "always responds" true. "other_image" does NOT go here —
    # unlike text, the orchestrator has no way to see the photo itself, so it
    # gets its own honest fixed reply instead (unsupported_image_node).
    if message_type == "unknown" and state.get("engage"):
        return "text_query"

    return message_type


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
_builder.add_node("unsupported_image", unsupported_image_node)
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
    "pantry_confirmation": "resume_from_confirmation",
    "other_image": "unsupported_image",
    "unknown": END,
    "silent": END,
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

# Asking ends this run — the group's reply arrives as its own WhatsApp message
# and re-enters at classify -> resume_from_confirmation.
_builder.add_edge("send_pantry_confirmation", END)
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
_builder.add_edge("unsupported_image", END)
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
