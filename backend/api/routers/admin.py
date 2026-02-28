from fastapi import APIRouter, Request, Depends
from supabase import create_client
from collections import defaultdict
import os

from api.dependencies.limiter import limiter
from api.dependencies.permissions import require_admin
from ingestion.news_fetcher import run as fetch_news
from pipelines.embedding_pipeline import embed_articles
from agents.digest_agent import get_users_for_digest, get_user_email, get_recent_articles_for_topics, generate_digest, send_digest
from agents.watchlist_digest_agent import run_watchlist_digest
from datetime import datetime

router = APIRouter(dependencies=[Depends(require_admin)])
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


def run_ingestion():
    fetch_news()
    embed_articles()


def run_digest_for_current_hour():
    current_hour_sgt = (datetime.utcnow().hour + 8) % 24
    current_time = f"{current_hour_sgt:02d}:00"
    print(f"Running digest check for SGT {current_time}")
    users = get_users_for_digest()
    for prefs in users:
        if prefs.get("digest_time", "07:00") == current_time:
            try:
                email = get_user_email(prefs["user_id"])
                if not email:
                    continue
                topics = prefs.get("topics") or ["global markets", "Singapore economy"]
                articles = get_recent_articles_for_topics(topics)
                digest = generate_digest(articles, topics)
                send_digest(email, digest, topics)
            except Exception as e:
                print(f"Error sending digest to user {prefs['user_id']}: {e}")


@router.post("/ingest")
@limiter.limit("5/minute")
def ingest(request: Request):
    run_ingestion()
    return {"status": "Ingestion complete"}


@router.post("/digest")
def digest(request: Request):
    run_digest_for_current_hour()
    return {"status": "Digest check complete"}


@router.post("/watchlist-digest")
def watchlist_digest(request: Request):
    run_watchlist_digest()
    return {"status": "Watchlist digests sent"}


@router.post("/eval")
def run_evaluation(request: Request, body: dict = {}):
    from evals.eval_runner import run_eval
    label = body.get("label")
    result = run_eval(label)
    return {
        "run_id": result["run_id"],
        "summary": result["summary"]
    }


@router.get("/admin/waitlist")
def get_waitlist(request: Request):
    response = supabase.table("waitlist")\
        .select("*")\
        .order("created_at", desc=True)\
        .execute()
    return response.data


@router.delete("/admin/waitlist/{entry_id}")
def delete_waitlist_entry(entry_id: str, request: Request):
    supabase.table("waitlist").delete().eq("id", entry_id).execute()
    return {"status": "deleted"}


@router.get("/admin/evals")
def get_eval_runs(request: Request):
    response = supabase.table("eval_runs")\
        .select("*")\
        .order("created_at", desc=True)\
        .execute()
    runs = defaultdict(list)
    for row in response.data:
        runs[row["run_id"]].append(row)
    summaries = []
    for run_id, rows in runs.items():
        summaries.append({
            "run_id": run_id,
            "created_at": rows[0]["created_at"],
            "questions": len(rows),
            "avg_overall": round(sum(r["overall_score"] for r in rows) / len(rows), 2),
            "avg_relevance": round(sum(r["relevance_score"] for r in rows) / len(rows), 2),
            "avg_groundedness": round(sum(r["groundedness_score"] for r in rows) / len(rows), 2),
            "avg_source_quality": round(sum(r["source_quality_score"] for r in rows) / len(rows), 2),
            "avg_confidence_accuracy": round(sum(r["confidence_accuracy_score"] for r in rows) / len(rows), 2),
        })
    return sorted(summaries, key=lambda x: x["created_at"], reverse=True)


@router.get("/admin/evals/{run_id}")
def get_eval_run_detail(run_id: str, request: Request):
    response = supabase.table("eval_runs")\
        .select("*")\
        .eq("run_id", run_id)\
        .order("created_at", desc=False)\
        .execute()
    return response.data


@router.get("/admin/logs")
def get_logs(request: Request):
    response = supabase.table("chat_history")\
        .select("id, user_id, question, answer, created_at")\
        .order("created_at", desc=True)\
        .limit(50)\
        .execute()
    return response.data
