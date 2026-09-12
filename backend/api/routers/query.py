import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from services.db import get_supabase

router = APIRouter()

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
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

    from agents.homly_graph import get_graph

    g = get_graph(with_memory=False)
    state = {
        "household_id": household_id,
        "group_jid": body.group_jid,
        "query": body.query,
        "image_bytes": None,
        "image_mime": None,
        "agent_results": [],
        "context": body.context or [],
        "response": None,
        "error": None,
    }
    result = await asyncio.to_thread(g.invoke, state)

    ar = result.get("agent_results") or []
    agent_result = next((r for r in ar if r.get("agent") in ("query", "pantry")), None)
    sources = agent_result["data"].get("sources", []) if agent_result else []
    handled = agent_result["data"].get("handled", False) if agent_result else False

    return {
        "response": result.get("response") or "I couldn't process that query.",
        "sources": sources,
        "handled": handled,
    }
