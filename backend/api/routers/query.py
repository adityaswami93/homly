from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()


class QueryRequest(BaseModel):
    query: str
    context: Optional[list[dict]] = None  # last N conversation turns for follow-up queries


@router.post("/query")
def query_endpoint(request: Request, body: QueryRequest):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    if not body.query.strip():
        raise HTTPException(status_code=400, detail="query must not be empty")

    from agents.router_agent import run_query

    result = run_query(
        query=body.query,
        household_id=household_id,
        context=body.context,
    )
    return {
        "response": result.response,
        "sources": result.sources,
        "handled": result.handled,
    }
