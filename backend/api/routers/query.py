import asyncio
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from supabase import create_client

router = APIRouter()

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


def _resolve_household_from_jid(group_jid: str) -> str | None:
    res = _db().table("settings").select("household_id").eq("group_jid", group_jid).execute()
    return res.data[0]["household_id"] if res.data else None


class QueryRequest(BaseModel):
    query: str
    context: Optional[list[dict]] = None   # last N turns for follow-up queries
    group_jid: Optional[str] = None        # bot callers: resolve household from WhatsApp group
    household_id: Optional[str] = None     # bot callers: explicit override


@router.post("/query")
async def query_endpoint(request: Request, body: QueryRequest):
    household_id = request.state.user.get("household_id")

    if not household_id and request.state.user.get("is_service_key"):
        household_id = body.household_id
        if not household_id and body.group_jid:
            household_id = await asyncio.to_thread(_resolve_household_from_jid, body.group_jid)

    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    if not body.query.strip():
        raise HTTPException(status_code=400, detail="query must not be empty")

    from agents.router_agent import run_query

    result = await asyncio.to_thread(run_query, body.query, household_id, body.context)
    return {
        "response": result.response,
        "sources": result.sources,
        "handled": result.handled,
    }
