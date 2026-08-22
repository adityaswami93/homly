import asyncio
import base64
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
import os

router = APIRouter()

# Shared state — bot pushes here, setup endpoints read from here
whatsapp_state: dict = {
    "qr": None,
    "connected": False,
    "groups": [],
    "qr_requested": False,
}

INTERNAL_KEY = os.getenv("INTERNAL_KEY", "homly-internal")


def _check(request: Request):
    if request.headers.get("X-Internal-Key") != INTERNAL_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.post("/internal/qr")
async def receive_qr(request: Request, body: dict):
    _check(request)
    whatsapp_state["qr"] = body.get("qr")
    whatsapp_state["connected"] = False
    return {"status": "ok"}


@router.post("/internal/connected")
async def receive_connected(request: Request, body: dict):
    _check(request)
    whatsapp_state["connected"] = True
    whatsapp_state["qr"] = None
    whatsapp_state["groups"] = body.get("groups", [])
    return {"status": "ok"}


@router.get("/internal/qr-status")
async def qr_status(request: Request):
    _check(request)
    requested = whatsapp_state.get("qr_requested", False)
    whatsapp_state["qr_requested"] = False
    return {"qr_requested": requested, "connected": whatsapp_state["connected"]}


@router.get("/internal/help")
async def help_text(request: Request):
    _check(request)
    from agents.orchestrator.registry import build_help_text
    return {"text": build_help_text()}


# ── LangGraph invocation ──────────────────────────────────────────────────────


class GraphInvokeRequest(BaseModel):
    household_id: str
    group_jid: Optional[str] = None
    thread_id: Optional[str] = None
    query: Optional[str] = None
    image_b64: Optional[str] = None
    image_mime: Optional[str] = None
    whatsapp_message_id: Optional[str] = None
    sender_name: Optional[str] = None
    sender_phone: Optional[str] = None


@router.post("/internal/graph-invoke")
async def graph_invoke(request: Request, body: GraphInvokeRequest):
    _check(request)

    from agents.homly_graph import get_graph

    image_bytes = base64.b64decode(body.image_b64) if body.image_b64 else None

    state = {
        "household_id": body.household_id,
        "group_jid": body.group_jid,
        "query": body.query,
        "image_bytes": image_bytes,
        "image_mime": body.image_mime,
        "whatsapp_message_id": body.whatsapp_message_id,
        "sender_name": body.sender_name,
        "sender_phone": body.sender_phone,
        "agent_results": [],
        "context": [],
        "response": None,
        "error": None,
    }

    thread_id = body.thread_id or body.group_jid or body.household_id
    config = {"configurable": {"thread_id": thread_id}}

    g = get_graph(with_memory=True)
    result = await asyncio.to_thread(g.invoke, state, config)

    return {
        "response": result.get("response"),
        "message_type": result.get("message_type"),
        "error": result.get("error"),
    }
