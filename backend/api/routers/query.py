import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()


class QueryRequest(BaseModel):
    query: str
    context: Optional[list[dict]] = None  # last N conversation turns for follow-up queries


@router.post("/query")
async def query_endpoint(request: Request, body: QueryRequest):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    if not body.query.strip():
        raise HTTPException(status_code=400, detail="query must not be empty")

    from agents.router_agent import run_query

    # run_query uses blocking I/O (Supabase + LLM); run in thread so the event loop stays free
    result = await asyncio.to_thread(
        run_query,
        body.query,
        household_id,
        body.context,
    )
    return {
        "response": result.response,
        "sources": result.sources,
        "handled": result.handled,
    }
