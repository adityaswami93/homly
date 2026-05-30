import json
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.llm_client import get_vision_completion

FRIDGE_PROMPT = """You are a kitchen inventory specialist. Scan this photo of a fridge, pantry shelf, or grocery items and identify everything visible.

Return ONLY a JSON object — no markdown, no explanation, no backticks. Exactly this schema:

{
  "items": [
    {
      "canonical_name": "lowercase normalised name",
      "quantity": 1,
      "unit": "pcs|kg|g|ml|L|carton|bunch|bottle|bag|box|whole|null",
      "category": "protein|produce|dairy|staples|condiments|beverages|other",
      "confidence": "high|medium|low"
    }
  ],
  "scan_confidence": "high|medium|low",
  "notes": "any caveats about visibility or ambiguity, or null"
}

Rules:
- Identify every distinct food item visible, including partial items
- For packaged goods, use the product type not the brand as canonical_name (e.g. "orange juice" not "Tropicana", "milk" not "Meiji milk")
- canonical_name must be lowercase with no brand, size, or pack info
- Estimate quantity from what is visible — count individual items where possible
- Mark confidence low if item is partially obscured, blurry, or ambiguous
- Ignore non-food items (containers, shelves, packaging without visible contents)
- unit should be null if you cannot determine it
- If the image is not a fridge, shelf, or grocery items at all, return {"items": [], "scan_confidence": "low", "notes": "image does not appear to show food items"}
"""


def scan_fridge(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    try:
        raw = get_vision_completion(FRIDGE_PROMPT, image_bytes, mime_type)

        clean = raw.strip()
        if clean.startswith("```"):
            parts = clean.split("```")
            clean = parts[1]
            if clean.startswith("json"):
                clean = clean[4:]
            clean = clean.strip()

        return json.loads(clean)

    except json.JSONDecodeError as e:
        print(f"[fridge_agent] JSON parse error: {e}\nRaw: {raw[:200]}")
        return {"error": "parse_error", "items": [], "scan_confidence": "low", "notes": "Failed to parse response"}
    except Exception as e:
        print(f"[fridge_agent] Error: {e}")
        return {"error": str(e), "items": [], "scan_confidence": "low", "notes": None}
