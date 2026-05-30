import os
import json
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.llm_client import get_vision_completion
from dotenv import load_dotenv

load_dotenv()

RECIPE_PROMPT = """You are a culinary expert and shopping list specialist. Identify the dish in this food photo and return the ingredients needed to cook it.

Return ONLY a JSON object — no markdown, no explanation, no backticks. Exactly this schema:

{
  "dish": "dish name or null",
  "serves": 4,
  "confidence": "high|medium|low",
  "ingredients": [
    {
      "name": "display name as you would write on a shopping list",
      "canonical_name": "lowercase normalised name, no quantities or sizes",
      "qty": 1,
      "unit": "whole|kg|g|ml|L|cups|tbsp|tsp|bunch|pcs or null",
      "category": "protein|produce|dairy|staples|condiments|other",
      "pantry_staple": false
    }
  ],
  "notes": "any caveats or null"
}

Rules:
- pantry_staple: true for items most households already have (salt, oil, sugar, soy sauce, sesame oil, pepper, cornstarch, basic spices, garlic, onion, water)
- canonical_name should be lowercase, drop brand/size/pack info (e.g. "chicken breast", "jasmine rice", "broccoli")
- serves defaults to 4 if not determinable from the image
- confidence: low if the dish is unclear or partially visible; still return best guess
- If completely unable to identify any food, return { "dish": null, "confidence": "low", "ingredients": [] }
- List only ingredients a shopper would need to buy — not every sub-component of a spice blend
- Include quantities appropriate for the serves count
"""


def analyse_dish(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    try:
        raw = get_vision_completion(RECIPE_PROMPT, image_bytes, mime_type)

        clean = raw.strip()
        if clean.startswith("```"):
            parts = clean.split("```")
            clean = parts[1]
            if clean.startswith("json"):
                clean = clean[4:]
            clean = clean.strip()

        return json.loads(clean)

    except json.JSONDecodeError as e:
        print(f"[recipe_agent] JSON parse error: {e}\nRaw: {raw[:200]}")
        return {"error": "parse_error", "dish": None, "confidence": "low", "ingredients": []}
    except Exception as e:
        print(f"[recipe_agent] Error: {e}")
        return {"error": str(e), "dish": None, "confidence": "low", "ingredients": []}


def _check_pantry(canonical_name: str, household_id: str, db) -> str:
    """Returns 'in_stock', 'low', 'out_of_stock', or 'unknown'"""
    res = (
        db.table("pantry_items")
        .select("status")
        .eq("household_id", household_id)
        .ilike("canonical_name", f"%{canonical_name}%")
        .limit(1)
        .execute()
    )
    if not res.data:
        return "unknown"
    return res.data[0]["status"]


def analyse_dish_with_pantry(
    image_bytes: bytes,
    mime_type: str,
    household_id: str,
    supabase_client,
) -> dict:
    result = analyse_dish(image_bytes, mime_type)
    ingredients = result.get("ingredients") or []

    need_to_buy: list[str] = []
    running_low: list[str] = []
    already_have: list[str] = []

    for ing in ingredients:
        if ing.get("pantry_staple"):
            continue
        canonical = (ing.get("canonical_name") or ing.get("name") or "").strip().lower()
        if not canonical:
            continue
        status = _check_pantry(canonical, household_id, supabase_client)
        ing["pantry_status"] = status
        if status == "in_stock":
            already_have.append(ing["name"])
        elif status == "low":
            running_low.append(ing["name"])
        else:
            need_to_buy.append(ing["name"])

    result["need_to_buy"] = need_to_buy
    result["running_low"] = running_low
    result["already_have"] = already_have
    return result


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if path:
        with open(path, "rb") as f:
            data = f.read()
        result = analyse_dish(data)
        print(json.dumps(result, indent=2))
    else:
        print("Usage: python -m agents.recipe_agent <image_path>")
