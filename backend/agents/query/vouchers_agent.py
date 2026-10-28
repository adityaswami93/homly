"""Chat access to the household's voucher wallet (services/vouchers.py).

Handles "any codes for Grab?", "what vouchers expire soon?", "used the
FairPrice one", a pasted promo SMS, and "save it as a voucher" in reply to a
photo the assistant just read. All rules (expiry, dedup, what "active" means)
live in services/vouchers.py — this file only maps intents onto it and words
the answer.

The read intents (list_vouchers, find_vouchers, expiring_soon) are exposed to
the unattended proactive monitor; add_voucher, save_from_document and
mark_used are not (agents/proactive_agent.py's _READONLY_INTENTS).
"""
import logging

from agents.base_agent import AgentManifest, AgentResult, BaseQueryAgent
from agents.voucher_agent import extract_from_text
from services import documents, vouchers
from services.household_time import household_today

logger = logging.getLogger(__name__)

MANIFEST = AgentManifest(
    name="vouchers",
    tool_name="query_vouchers",
    description=(
        "The household's voucher and promo-code wallet. Lists usable vouchers, finds codes for a "
        "shop/brand/app, lists ones expiring soon, saves a new code (from details or a pasted "
        "promo message), saves a voucher from a photo the assistant just read, and marks a "
        "voucher as used."
    ),
    intents=[
        {"name": "list_vouchers", "description": "List all usable (active, unexpired) vouchers"},
        {"name": "find_vouchers", "description": "Usable vouchers/codes for a merchant (params.merchant)"},
        {"name": "expiring_soon", "description": "Usable vouchers expiring within params.within_days (default 7)"},
        {
            "name": "add_voucher",
            "description": (
                "Save a voucher/promo code. Pass params.text with the promo message as the user "
                "wrote/pasted it, and/or the fields you already know (merchant, code, ...)"
            ),
        },
        {
            "name": "save_from_document",
            "description": (
                "Save a voucher from a photo the assistant read. params.document_id if known; "
                "otherwise the most recently read photo is used"
            ),
        },
        {"name": "mark_used", "description": "Mark a voucher used — identify it by params.code and/or params.merchant"},
    ],
    params_schema={
        "type": "object",
        "properties": {
            "merchant": {"type": "string", "description": "Shop/brand/app, e.g. FairPrice, Grab"},
            "code": {"type": "string", "description": "The promo code exactly as written"},
            "text": {"type": "string", "description": "add_voucher: the promo message verbatim"},
            "title": {"type": "string"},
            "value_type": {"type": "string", "description": "amount, percent, freebie or other"},
            "value": {"type": "number"},
            "min_spend": {"type": "number"},
            "expires_at": {"type": "string", "description": "YYYY-MM-DD, last day it can be used"},
            "terms": {"type": "string"},
            "document_id": {"type": "string", "description": "save_from_document: the read photo's id"},
            "within_days": {"type": "integer", "description": "expiring_soon: look-ahead in days"},
        },
    },
    examples=["any promo codes for Grab?", "save code SAVE20 — 20% off Lazada till 30 Nov"],
)


def _result(intent: str, handled: bool, nl: str, data: dict | None = None) -> AgentResult:
    return AgentResult(agent="vouchers", handled=handled, intent=intent, data=data or {}, natural_language=nl)


def _list_text(rows: list[dict], empty: str, header: str) -> str:
    if not rows:
        return empty
    return header + "\n" + "\n".join(f"• {vouchers.describe(r)}" for r in rows)


class VouchersQueryAgent(BaseQueryAgent):
    @property
    def manifest(self) -> AgentManifest:
        return MANIFEST

    def handle(self, intent: str, params: dict, household_id: str,
               sender_name: str | None = None, sender_phone: str | None = None) -> AgentResult:
        params = params or {}
        try:
            if intent == "list_vouchers":
                rows = vouchers.list_vouchers(household_id, "active")
                return _result(intent, True, _list_text(
                    rows, "No usable vouchers saved right now.",
                    f"{len(rows)} usable voucher(s):"), {"vouchers": rows})
            if intent == "find_vouchers":
                merchant = (params.get("merchant") or "").strip()
                rows = vouchers.find_vouchers(household_id, merchant=merchant or None)
                return _result(intent, True, _list_text(
                    rows, f"No usable vouchers for {merchant or 'that'}.",
                    f"Vouchers for {merchant}:" if merchant else "Usable vouchers:"), {"vouchers": rows})
            if intent == "expiring_soon":
                days = int(params.get("within_days") or vouchers.EXPIRING_SOON_DAYS)
                rows = vouchers.expiring_soon(household_id, days)
                return _result(intent, True, _list_text(
                    rows, f"Nothing expiring in the next {days} days.",
                    f"Expiring within {days} days:"), {"vouchers": rows})
            if intent == "add_voucher":
                return self._add(params, household_id, sender_name, sender_phone)
            if intent == "save_from_document":
                return self._save_from_document(params, household_id, sender_name, sender_phone)
            if intent == "mark_used":
                return self._mark_used(params, household_id, sender_name)
        except Exception as e:
            logger.exception("Vouchers agent failed intent=%s household_id=%s", intent, household_id)
            return _result(intent, False, f"Sorry, I couldn't do that: {e}", {"error": str(e)})
        return _result(intent, False, "Unknown intent.")

    def _save(self, intent: str, household_id: str, data: dict, **kw) -> AgentResult:
        row, created, error = vouchers.create_voucher(household_id, data, **kw)
        if error:
            return _result(intent, False, error)
        if not created:
            return _result(intent, True, f"Already in the wallet: {vouchers.describe(row)}", {"voucher": row})
        nl = f"🎟️ Saved: {vouchers.describe(row)}"
        if row.get("confidence") == "low" and row.get("code"):
            nl += "\n_Please double-check the code — part of it was hard to read._"
        return _result(intent, True, nl, {"voucher": row})

    def _add(self, params: dict, household_id: str, sender_name, sender_phone) -> AgentResult:
        data = {k: v for k, v in params.items() if v not in (None, "") and k != "text"}
        confidence = "high"
        text = (params.get("text") or "").strip()
        if text:
            extracted = extract_from_text(text, today=household_today(household_id))
            if extracted.get("is_voucher"):
                confidence = extracted.get("confidence", "medium")
                # What the supervisor passed explicitly wins over the re-read.
                data = {**{k: v for k, v in extracted.items() if v not in (None, "")}, **data}
        return self._save("add_voucher", household_id, data, source="whatsapp", confidence=confidence,
                          added_by_name=sender_name, added_by_phone=sender_phone)

    def _save_from_document(self, params: dict, household_id: str, sender_name, sender_phone) -> AgentResult:
        doc = None
        if params.get("document_id"):
            doc = documents.get_document(household_id, params["document_id"])
        if doc is None:
            recent = documents.recent_documents(household_id, limit=1)
            doc = documents.get_document(household_id, recent[0]["id"]) if recent else None
        if doc is None:
            return _result("save_from_document", False, "I can't find a recent photo to save a voucher from.")

        text = "\n".join(filter(None, [doc.get("title"), doc.get("summary"), doc.get("extracted_text")]))
        extracted = extract_from_text(text, today=household_today(household_id))
        if not extracted.get("is_voucher"):
            return _result("save_from_document", False,
                           f"I couldn't find a voucher or code in \"{doc.get('title')}\".")
        explicit = {k: v for k, v in params.items() if v not in (None, "") and k not in ("document_id", "text")}
        data = {**{k: v for k, v in extracted.items() if v not in (None, "")}, **explicit}
        return self._save(
            "save_from_document", household_id, data, source="document", document_id=doc["id"],
            confidence=extracted.get("confidence"),
            # The photo is the voucher when it's barcode/QR-only — keep it.
            image_path=self._copy_image(doc, household_id),
            added_by_name=sender_name, added_by_phone=sender_phone,
        )

    @staticmethod
    def _copy_image(doc: dict, household_id: str) -> str | None:
        """The document's image, copied into the vouchers bucket — documents
        expire on their own schedule (services/documents.RETENTION_DAYS) and a
        voucher's image must not vanish with them."""
        path = doc.get("image_path")
        if not path:
            return None
        blob = documents.download_image(path)
        if blob is None:
            return None
        return documents.upload_image(blob, doc.get("mime_type") or "image/jpeg", household_id,
                                      bucket=vouchers.BUCKET)

    def _mark_used(self, params: dict, household_id: str, sender_name) -> AgentResult:
        code = (params.get("code") or "").strip() or None
        merchant = (params.get("merchant") or "").strip() or None
        if not code and not merchant:
            return _result("mark_used", False, "Which voucher — what's the shop or the code?")
        matches = vouchers.find_vouchers(household_id, merchant=merchant, code=code)
        if not matches:
            return _result("mark_used", False, "I couldn't find a usable voucher matching that.")
        if len(matches) > 1:
            return _result("mark_used", False, _list_text(
                matches, "", "More than one matches — which one did you use?"), {"vouchers": matches})
        used = vouchers.mark_used(household_id, matches[0]["id"], sender_name)
        return _result("mark_used", True,
                       f"✅ Marked as used: {vouchers.describe(used or matches[0])}", {"voucher": used})
