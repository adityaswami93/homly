import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client
from agents.rag_agent import ask_agent
from evals.eval_metrics import score_response

load_dotenv()

supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

GOLDEN_DATASET_PATH = os.path.join(os.path.dirname(__file__), "golden_dataset.json")
RESULTS_PATH = os.path.join(os.path.dirname(__file__), "results")


def load_golden_dataset() -> list:
    with open(GOLDEN_DATASET_PATH) as f:
        return json.load(f)


def save_results_locally(run_id: str, results: list, summary: dict):
    os.makedirs(RESULTS_PATH, exist_ok=True)
    output = {
        "run_id": run_id,
        "timestamp": datetime.utcnow().isoformat(),
        "summary": summary,
        "results": results
    }
    path = os.path.join(RESULTS_PATH, f"{run_id}.json")
    with open(path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Results saved locally: {path}")


def save_results_to_supabase(run_id: str, results: list):
    for r in results:
        supabase.table("eval_runs").insert({
            "run_id": run_id,
            "question_id": r["question_id"],
            "question": r["question"],
            "difficulty": r["difficulty"],
            "answer": r["answer"],
            "sources": r["sources"],
            "confidence": r["confidence"],
            "iterations": r["iterations"],
            "relevance_score": r["scores"]["relevance"],
            "groundedness_score": r["scores"]["groundedness"],
            "source_quality_score": r["scores"]["source_quality"],
            "confidence_accuracy_score": r["scores"]["confidence_accuracy"],
            "overall_score": r["scores"]["overall"],
            "notes": r["scores"]["notes"],
            "model": "openai/gpt-4o-mini"
        }).execute()
    print(f"Results saved to Supabase: {len(results)} rows")


def print_report(run_id: str, results: list, summary: dict):
    print(f"\n{'='*80}")
    print(f"EVAL RUN: {run_id}")
    print(f"Model: openai/gpt-4o-mini")
    print(f"Questions: {len(results)}")
    print(f"{'='*80}\n")

    for r in results:
        s = r["scores"]
        print(f"[{r['difficulty'].upper()}] {r['question'][:60]}...")
        print(f"  Confidence: {r['confidence']} | Iterations: {r['iterations']}")
        print(f"  Scores — Relevance: {s['relevance']} | Groundedness: {s['groundedness']} | Source: {s['source_quality']} | Conf accuracy: {s['confidence_accuracy']} | Overall: {s['overall']}")
        print(f"  Notes: {s['notes']}")
        print()

    print(f"{'='*80}")
    print(f"AVERAGES:")
    print(f"  Relevance:            {summary['avg_relevance']:.2f}")
    print(f"  Groundedness:         {summary['avg_groundedness']:.2f}")
    print(f"  Source Quality:       {summary['avg_source_quality']:.2f}")
    print(f"  Confidence Accuracy:  {summary['avg_confidence_accuracy']:.2f}")
    print(f"  Overall:              {summary['avg_overall']:.2f}")
    print(f"{'='*80}\n")


def run_eval(run_label: str = None):
    run_id = run_label or f"eval-{datetime.utcnow().strftime('%Y-%m-%d-%H-%M')}"
    print(f"\nStarting eval run: {run_id}")

    dataset = load_golden_dataset()
    results = []

    for i, item in enumerate(dataset):
        print(f"\n[{i+1}/{len(dataset)}] {item['question']}")
        try:
            # Run through agent
            response = ask_agent(item["question"])

            # Score the response
            scores = score_response(
                question=item["question"],
                answer=response["answer"],
                sources=response["sources"],
                confidence=response["confidence"],
                expected_topics=item["expected_topics"]
            )

            results.append({
                "question_id": item["id"],
                "question": item["question"],
                "difficulty": item["difficulty"],
                "answer": response["answer"],
                "sources": response["sources"],
                "confidence": response["confidence"],
                "iterations": response["iterations"],
                "scores": scores
            })

            print(f"  Overall score: {scores['overall']}/5 — {scores['notes']}")

        except Exception as e:
            print(f"  Error: {e}")
            results.append({
                "question_id": item["id"],
                "question": item["question"],
                "difficulty": item["difficulty"],
                "answer": f"ERROR: {e}",
                "sources": [],
                "confidence": "low",
                "iterations": 0,
                "scores": {
                    "relevance": 0, "groundedness": 0,
                    "source_quality": 0, "confidence_accuracy": 0,
                    "overall": 0, "notes": f"Error: {e}"
                }
            })

    # Calculate summary
    summary = {
        "avg_relevance": sum(r["scores"]["relevance"] for r in results) / len(results),
        "avg_groundedness": sum(r["scores"]["groundedness"] for r in results) / len(results),
        "avg_source_quality": sum(r["scores"]["source_quality"] for r in results) / len(results),
        "avg_confidence_accuracy": sum(r["scores"]["confidence_accuracy"] for r in results) / len(results),
        "avg_overall": sum(r["scores"]["overall"] for r in results) / len(results),
        "total_questions": len(results)
    }

    # Save results
    print_report(run_id, results, summary)
    save_results_locally(run_id, results, summary)
    save_results_to_supabase(run_id, results)

    return {"run_id": run_id, "summary": summary, "results": results}


if __name__ == "__main__":
    import sys
    label = sys.argv[1] if len(sys.argv) > 1 else None
    run_eval(label)
