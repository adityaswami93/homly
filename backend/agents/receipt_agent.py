import os
import json
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.llm_client import get_vision_completion
from dotenv import load_dotenv

load_dotenv()

RECEIPT_PROMPT = """You are a receipt OCR specialist. Extract all information from this receipt image.

Return ONLY a JSON object — no markdown, no explanation, no backticks. Exactly this schema:

{
  "vendor": "store name or null",
  "date": "YYYY-MM-DD or null",
  "items": [
    {
      "name": "item name",
      "qty": 1,
      "unit_price": 0.00,
      "line_total": 0.00,
      "category": "groceries|household|personal care|food & beverage|transport|other"
    }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00,
  "currency": "SGD",
  "confidence": "high|medium|low",
  "notes": "any issues e.g. blurry, partial, handwritten, or null"
}

Category rules:
- groceries: raw food, produce, meat, dairy, canned goods, beverages
- household: cleaning products, laundry, home supplies, batteries, light bulbs
- personal care: toiletries, shampoo, soap, medicine, cosmetics
- food & beverage: prepared food, restaurant, hawker, drinks to consume immediately
- transport: bus, MRT, taxi, Grab, parking, petrol
- other: anything that does not fit above

Confidence rules:
- high: clear image, all text readable, totals add up
- medium: some text unclear but totals readable
- low: blurry, cut off, handwritten, totals unreadable

Important:
- Default currency to SGD unless clearly stated otherwise
- If a field is genuinely unreadable, use null — do not guess
- qty defaults to 1 if not shown
- If you can only read the total and not individual items, return items: []
"""


def analyse_receipt(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    try:
        raw = get_vision_completion(RECEIPT_PROMPT, image_bytes, mime_type)

        clean = raw.strip()
        if clean.startswith("```"):
            parts = clean.split("```")
            clean = parts[1]
            if clean.startswith("json"):
                clean = clean[4:]
            clean = clean.strip()

        result = json.loads(clean)
        result["flagged"] = result.get("confidence") == "low" or result.get("total") is None
        return result

    except json.JSONDecodeError as e:
        print(f"[receipt_agent] JSON parse error: {e}\nRaw: {raw[:200]}")
        return {"error": "parse_error", "raw": raw, "flagged": True, "confidence": "low"}
    except Exception as e:
        print(f"[receipt_agent] Error: {e}")
        return {"error": str(e), "flagged": True, "confidence": "low"}


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if path:
        with open(path, "rb") as f:
            data = f.read()
        result = analyse_receipt(data)
        print(json.dumps(result, indent=2))
    else:
        print("Usage: python -m agents.receipt_agent <image_path>")
