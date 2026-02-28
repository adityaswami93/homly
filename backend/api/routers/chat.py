from fastapi import APIRouter, Request
from supabase import create_client
import os

from api.dependencies.limiter import limiter
from api.models import Question
from agents.rag_agent import ask_agent


router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


@router.post("/ask")
@limiter.limit("10/minute")
def ask_question(request: Request, body: Question):
    user_id = request.state.user["sub"]
    result = ask_agent(body.question)  # use agent instead of ask()
    supabase.table("chat_history").insert({
        "user_id": user_id,
        "question": body.question,
        "answer": result["answer"],
        "sources": result["sources"]
    }).execute()
    return result


@router.get("/history")
def get_history(request: Request):
    user_id = request.state.user["sub"]
    response = supabase.table("chat_history")\
        .select("*")\
        .eq("user_id", user_id)\
        .order("created_at", desc=True)\
        .execute()
    return response.data
