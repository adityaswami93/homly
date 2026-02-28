import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
from services.llm_client import get_completion


def score_response(
    question: str,
    answer: str,
    sources: list,
    confidence: str,
    expected_topics: list
) -> dict:
    source_titles = [s["title"] for s in sources] if sources else []

    prompt = f"""You are an expert evaluator of financial AI systems. Score this RAG system response across 4 dimensions.

Question: {question}
Expected topics: {expected_topics}
Agent confidence: {confidence}
Answer: {answer}
Sources used: {source_titles}

Scoring rubric:
- Relevance (1-5): Does the answer directly address what was asked? 5=perfectly on topic, 1=completely off topic
- Groundedness (1-5): Are the answer's claims supported by the cited sources? 5=fully grounded, 1=hallucinated or unsupported
- Source quality (1-5): Did retrieval surface articles relevant to the expected topics? 5=all sources on point, 1=no relevant sources
- Confidence accuracy (1-5): Does the agent's stated confidence match the actual answer quality? 5=perfectly calibrated, 1=wildly miscalibrated

Respond ONLY in JSON with no other text:
{{
  "relevance": <1-5>,
  "groundedness": <1-5>,
  "source_quality": <1-5>,
  "confidence_accuracy": <1-5>,
  "overall": <1-5>,
  "notes": "one sentence explanation of the scores"
}}"""

    response = get_completion(prompt)
    try:
        clean = response.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
        return json.loads(clean.strip())
    except Exception as e:
        print(f"Error parsing scores: {e}")
        return {
            "relevance": 0,
            "groundedness": 0,
            "source_quality": 0,
            "confidence_accuracy": 0,
            "overall": 0,
            "notes": f"Failed to parse: {e}"
        }
