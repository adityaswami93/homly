import os
import json
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.llm_client import get_vision_completion
from dotenv import load_dotenv

load_dotenv()

INSURANCE_PROMPT = """You are an insurance document specialist. Extract all policy details from this document.

Return ONLY a JSON object — no markdown, no explanation, no backticks. Exactly this schema:

{
  "provider": "insurance company name or null",
  "policy_number": "policy number or null",
  "coverage_type": "health|life|home|car|travel|other",
  "insured_person": "name of insured person/policyholder or null",
  "coverage_amount": 500000.00,
  "premium_amount": 200.00,
  "premium_frequency": "monthly|quarterly|annually or null",
  "renewal_date": "YYYY-MM-DD or null",
  "notes": "extra info like deductibles, co-pay, beneficiary, waiting period or null",
  "summary": "2-3 sentence plain English summary of what this policy covers and key limits",
  "coverage_details": {
    "covered": ["list of covered events, conditions, or benefits"],
    "exclusions": ["list of explicit exclusions mentioned in the document"],
    "limits": {
      "hospitalization": "coverage limit as string or null",
      "outpatient": "coverage limit as string or null",
      "dental": "coverage limit as string or null",
      "death_benefit": "coverage limit as string or null",
      "other": {}
    },
    "waiting_period": "waiting period text if mentioned or null",
    "deductible": "deductible amount as string or null",
    "beneficiaries": ["beneficiary names if mentioned"]
  },
  "confidence": "high|medium|low"
}

Coverage type rules:
- health: medical, hospital, dental, vision, critical illness, MediShield
- life: term life, whole life, endowment, investment-linked
- home: property, contents, fire, homeowners, HDB fire
- car: motor, vehicle, auto, comprehensive, TPFT
- travel: trip cancellation, travel medical, baggage, overseas
- other: anything that does not clearly fit above

Premium frequency rules:
- Use exactly "monthly", "quarterly", or "annually"
- Map "yearly" → "annually", "annual" → "annually"
- If unclear or not stated, return null

Confidence rules:
- high: clear document, all key fields readable and consistent
- medium: some fields unclear but provider and coverage type are readable
- low: cannot identify basic policy details or document is too blurry/incomplete

Important:
- All monetary amounts should be numeric (no currency symbols, no commas)
- Renewal date = policy expiry/end date in YYYY-MM-DD format
- If a field is genuinely absent from the document, use null — do not guess
- The summary must be plain English for a non-expert reader (2-3 sentences max)
- Extract covered events and exclusions verbatim or closely paraphrased from the document
"""


def analyse_insurance_document(file_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """
    Analyse an insurance policy document (PDF or image) using a vision LLM.
    Returns a dict with extracted policy fields + AI summary + structured coverage_details.

    Supports: image/jpeg, image/png, image/webp, application/pdf
    """
    try:
        raw = get_vision_completion(INSURANCE_PROMPT, file_bytes, mime_type)

        clean = raw.strip()
        if clean.startswith("```"):
            parts = clean.split("```")
            clean = parts[1]
            if clean.startswith("json"):
                clean = clean[4:]
            clean = clean.strip()

        return json.loads(clean)

    except json.JSONDecodeError as e:
        print(f"[insurance_agent] JSON parse error: {e}\nRaw (first 200): {raw[:200]}")
        return {
            "error": "parse_error",
            "raw": raw,
            "confidence": "low",
            "summary": None,
            "coverage_details": None,
        }
    except Exception as e:
        print(f"[insurance_agent] Error: {e}")
        return {
            "error": str(e),
            "confidence": "low",
            "summary": None,
            "coverage_details": None,
        }


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if path:
        mime = "application/pdf" if path.endswith(".pdf") else "image/jpeg"
        with open(path, "rb") as f:
            data = f.read()
        result = analyse_insurance_document(data, mime_type=mime)
        print(json.dumps(result, indent=2))
    else:
        print("Usage: python -m agents.insurance_agent <document_path>")
