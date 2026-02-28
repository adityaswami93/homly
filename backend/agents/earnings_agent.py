import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
from services.llm_client import get_completion
from dotenv import load_dotenv

load_dotenv()

def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    import PyPDF2
    import io
    reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
    text = ""
    for page in reader.pages:
        text += page.extract_text() + "\n"
    return text

def analyse_earnings(transcript_text: str, ticker: str = "") -> dict:
    transcript_truncated = transcript_text[:12000]

    prompt = f"""You are a senior equity analyst at a hedge fund. Analyse this earnings call transcript and extract structured insights a portfolio manager needs.

- For guidance direction: check ALL of the following — revenue outlook, EPS guidance, capex plans, expense forecasts. If ANY of these were raised vs prior communication, use "raised". Meta guiding $60-65B capex vs prior estimates counts as "raised" even if not explicitly stated as a raise.
- For management tone: "bullish" means clearly optimistic and confident. "cautious" means clearly concerned or hesitant. "neutral" means neither.
- For beat/miss: "beat" means results exceeded analyst consensus estimates. "miss" means below. "in-line" means roughly in line.

Ticker: {ticker if ticker else "Unknown"}

Transcript:
{transcript_truncated}

Provide a structured analysis in the following JSON format exactly, with no other text:
{{
  "revenue_eps": {{
    "summary": "2-3 sentence summary of revenue and EPS vs estimates",
    "beat_miss": "beat | miss | in-line",
    "key_numbers": ["specific number 1", "specific number 2"]
  }},
  "guidance": {{
    "summary": "2-3 sentence summary of forward guidance",
    "direction": "raised | lowered | maintained | withdrawn",
    "key_quotes": ["direct quote from management"]
  }},
  "management_tone": {{
    "summary": "2-3 sentence assessment of management confidence and tone",
    "sentiment": "bullish | neutral | cautious | bearish"
  }},
  "key_risks": {{
    "summary": "2-3 sentence overview of key risks mentioned",
    "risks": ["risk 1", "risk 2", "risk 3"]
  }},
  "qa_highlights": {{
    "summary": "2-3 sentence summary of analyst Q&A themes",
    "highlights": ["key exchange 1", "key exchange 2"]
  }},
  "bull_bear": {{
    "bull_case": "2-3 sentence bull case based on the call",
    "bear_case": "2-3 sentence bear case based on the call",
    "overall": "bullish | neutral | bearish"
  }}
}}"""

    response = get_completion(prompt)

    try:
        # Strip markdown code blocks if present
        clean = response.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
        return json.loads(clean.strip())
    except Exception as e:
        print(f"Error parsing JSON: {e}")
        return {"error": "Failed to parse analysis", "raw": response}