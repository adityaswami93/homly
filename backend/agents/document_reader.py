"""Reads a photo the household sent the assistant and works out what it's for.

Used by agents/homly_graph.py's read_image_node for any photo that isn't a
receipt, a dish, a fridge scan or a clear-cut voucher — a school letter, a
bill, an appointment card, an invitation, a screenshot of a message. Returns
the text in it, a short summary, the facts worth remembering (dates, amounts,
reference numbers), and 1–3 things the household might want done about it.

The suggestions are constrained to what Homly can actually do: the prompt is
handed `capabilities`, built from the registered chat agents
(agents/orchestrator/registry.describe_capabilities()), so the assistant never
offers something it can't follow through on when the group says "yes, do 1".

Nothing here writes. The caller stores the result (services/documents.py) and
asks the group; acting on the answer is the chat supervisor's job, on the next
message, with this reading in the conversation context.
"""
import logging
from datetime import date

from services.llm_client import get_vision_completion, parse_json_object

logger = logging.getLogger(__name__)

DOC_TYPES = (
    "letter", "bill", "invitation", "notice", "appointment", "form",
    "schedule", "screenshot", "voucher", "photo", "other",
)

_PROMPT = """You are a household assistant reading a photo someone sent to their family's group chat.
{caption_line}Today is {today}.

Read everything in the image and reply with ONLY a JSON object — no markdown, no explanation:

{{
  "doc_type": "one of: {doc_types}",
  "title": "a short, specific name for it, e.g. 'Science Centre excursion letter' or 'SP Group electricity bill, Oct'",
  "summary": "one or two plain sentences: what this is and what it asks of the household, if anything",
  "extracted_text": "all readable text in the image, in reading order; empty string if there is none",
  "key_facts": [{{"label": "Due date", "value": "2026-11-07"}}],
  "suggested_actions": [{{"label": "Remind us to pay the $12 fee by 7 Nov"}}]
}}

Rules:
- key_facts: at most 6 — dates (as YYYY-MM-DD), amounts, deadlines, reference/account numbers, names, places. Only facts actually in the image.
- suggested_actions: 1 to 3 concrete next steps a family would want, written as short offers in plain language.
  Only suggest things this assistant can do:
{capabilities}
  If nothing above fits, return an empty list — never invent a capability.
- doc_type "voucher" if it is mainly a voucher, coupon, promo code or discount offer.
- doc_type "photo" if it is an ordinary photo with little or no text; then summary describes what is shown.
- Never invent text you cannot read.
"""


def read_image(
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    caption: str | None = None,
    capabilities: str = "",
    today: date | None = None,
) -> dict:
    """{doc_type, title, summary, extracted_text, key_facts, suggested_actions}
    or {"error": ...} when the model call or its reply failed."""
    if mime_type == "application/pdf":
        from agents.receipt_agent import pdf_to_image_bytes
        image_bytes, mime_type = pdf_to_image_bytes(image_bytes)

    caption = (caption or "").strip()
    prompt = _PROMPT.format(
        caption_line=f'It came with the caption: "{caption[:500]}"\n' if caption else "",
        today=(today or date.today()).isoformat(),
        doc_types=", ".join(DOC_TYPES),
        capabilities=capabilities or "  - (no actions available — return an empty list)",
    )
    raw = ""
    try:
        raw = get_vision_completion(prompt, image_bytes, mime_type)
        reading = normalize_reading(parse_json_object(raw))
    except Exception as e:
        logger.error(f"[document_reader] read failed: {e} raw={raw[:200]!r}")
        return {"error": str(e)}
    # A reply with neither a summary nor any text is a failed read, not an
    # empty document — storing it would announce "📄 Photo" and remember nothing.
    if not reading["summary"] and not reading["extracted_text"]:
        return {"error": "nothing readable in the model's reply"}
    return reading


def normalize_reading(parsed: dict) -> dict:
    doc_type = parsed.get("doc_type") if parsed.get("doc_type") in DOC_TYPES else "other"

    facts = []
    for f in parsed.get("key_facts") or []:
        if isinstance(f, dict) and f.get("label") and f.get("value") not in (None, ""):
            facts.append({"label": str(f["label"])[:60], "value": str(f["value"])[:200]})

    actions = []
    for a in parsed.get("suggested_actions") or []:
        label = a.get("label") if isinstance(a, dict) else a
        if isinstance(label, str) and label.strip():
            actions.append({"label": label.strip()[:160]})

    return {
        "doc_type": doc_type,
        "title": (str(parsed.get("title") or "").strip() or "Photo")[:200],
        "summary": str(parsed.get("summary") or "").strip()[:1000],
        "extracted_text": str(parsed.get("extracted_text") or "").strip()[:20000],
        "key_facts": facts[:6],
        "suggested_actions": actions[:3],
    }
