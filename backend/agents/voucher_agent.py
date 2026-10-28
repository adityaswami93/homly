"""Reads a voucher or promo code out of a photo, a screenshot, or pasted text.

Shared by every entry point (services/vouchers.py's docstring lists them) so a
voucher read on the dashboard and one read in the WhatsApp group come out the
same shape. Extraction only — nothing here writes; callers hand the result to
services/vouchers.create_voucher().

The code itself is the one field that must be exact. A vision model can read
"O" for "0" or "I" for "1", so the prompt asks for the code verbatim and a
`confidence` the caller surfaces (the WhatsApp reply says "double-check the
code", the dashboard shows the image next to the field) rather than trusting
a guess silently.
"""
import logging
from datetime import date

from services.llm_client import get_completion, get_vision_completion, parse_json_object

logger = logging.getLogger(__name__)

_SCHEMA = """{
  "is_voucher": true,
  "merchant": "shop/brand/app it is redeemed at, e.g. FairPrice, Grab, Lazada",
  "title": "short description, e.g. '$10 off groceries' or 'Free coffee'",
  "code": "the promo/voucher code EXACTLY as printed, or null if it is barcode/QR only",
  "kind": "promo_code | voucher | cashback | other",
  "value_type": "amount | percent | freebie | other",
  "value": 10,
  "currency": "SGD or null",
  "min_spend": 80,
  "expires_at": "YYYY-MM-DD or null",
  "terms": "key conditions in one or two lines, or null",
  "confidence": "high | medium | low"
}"""

_RULES = """Rules:
- Copy the code character-for-character. Never correct, translate or guess it; if any character is unreadable set confidence to "low".
- value is a number without currency symbols (10 for "$10 off", 15 for "15% off"); null if not stated.
- expires_at is the LAST day it can be used. Today is {today}; resolve relative or partial dates ("valid till 30 Nov", "ends Sunday") against it. null if no expiry is stated.
- kind: "promo_code" for a typed code, "voucher" for a printed/e-voucher (often barcode/QR), "cashback" for cashback offers.
- If this is not a voucher, coupon, promo code or discount offer at all, return {{"is_voucher": false}}."""

# _SCHEMA is literal JSON, so its braces are escaped before it goes into a
# str.format() template; _RULES is already written with {{ }} escapes.
_SCHEMA_FMT = _SCHEMA.replace("{", "{{").replace("}", "}}")

_IMAGE_PROMPT = (
    "Extract the voucher / promo code from this image.\n\n"
    "Return ONLY a JSON object — no markdown, no explanation — with this schema:\n"
    f"{_SCHEMA_FMT}\n\n{_RULES}"
)

_TEXT_PROMPT = (
    "Extract the voucher / promo code from this message.\n\n"
    "Message:\n\"\"\"\n{text}\n\"\"\"\n\n"
    "Return ONLY a JSON object — no markdown, no explanation — with this schema:\n"
    f"{_SCHEMA_FMT}\n\n{_RULES}"
)


def _finish(parsed: dict) -> dict:
    if not parsed.get("is_voucher", True):
        return {"is_voucher": False}
    parsed["is_voucher"] = True
    if parsed.get("confidence") not in ("high", "medium", "low"):
        parsed["confidence"] = "medium"
    return parsed


def extract_from_image(image_bytes: bytes, mime_type: str = "image/jpeg",
                       today: date | None = None) -> dict:
    """{is_voucher, merchant, code, ...} or {"is_voucher": False} / {"error": ...}."""
    if mime_type == "application/pdf":
        from agents.receipt_agent import pdf_to_image_bytes
        image_bytes, mime_type = pdf_to_image_bytes(image_bytes)
    raw = ""
    try:
        prompt = _IMAGE_PROMPT.format(today=(today or date.today()).isoformat())
        raw = get_vision_completion(prompt, image_bytes, mime_type)
        return _finish(parse_json_object(raw))
    except Exception as e:
        logger.error(f"[voucher_agent] image extraction failed: {e} raw={raw[:200]!r}")
        return {"is_voucher": False, "error": str(e)}


def extract_from_text(text: str, today: date | None = None) -> dict:
    text = (text or "").strip()
    if not text:
        return {"is_voucher": False}
    raw = ""
    try:
        prompt = _TEXT_PROMPT.format(today=(today or date.today()).isoformat(), text=text[:4000])
        raw = get_completion(prompt, system="You extract structured data. Reply with JSON only.")
        return _finish(parse_json_object(raw))
    except Exception as e:
        logger.error(f"[voucher_agent] text extraction failed: {e} raw={raw[:200]!r}")
        return {"is_voucher": False, "error": str(e)}
