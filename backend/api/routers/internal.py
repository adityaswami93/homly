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
    # Set by the WhatsApp client from things only it can see: an @mention of the
    # bot's own JID (stripped from `query` before it gets here) and a reply to
    # one of the bot's own messages. Both feed the engagement gate in
    # agents/homly_graph.py's classify_node.
    was_mentioned: bool = False
    is_reply_to_bot: bool = False


def _inbound_text(body: "GraphInvokeRequest") -> str:
    """What this message looks like in the transcript.

    A photo's caption is the only part of it the assistant can read back later,
    so the marker is what keeps "what was that receipt again?" answerable
    instead of leaving a silent gap in the conversation.
    """
    text = (body.query or "").strip()
    if body.image_b64:
        return f"[sent a photo] {text}".strip()
    return text


@router.post("/internal/graph-invoke")
async def graph_invoke(request: Request, body: GraphInvokeRequest):
    _check(request)

    from agents.homly_graph import get_graph
    from services import conversation

    image_bytes = base64.b64decode(body.image_b64) if body.image_b64 else None

    # Load the conversation *before* recording this message, so the context the
    # graph reasons over is everything said up to now and this message appears
    # exactly once (as the query itself, not also as the last context entry).
    context = await asyncio.to_thread(
        conversation.get_context, body.household_id, body.group_jid
    )
    await asyncio.to_thread(
        conversation.record_user_message,
        body.household_id,
        body.group_jid,
        _inbound_text(body),
        body.sender_name,
        body.sender_phone,
        body.whatsapp_message_id,
    )

    state = {
        "household_id": body.household_id,
        "group_jid": body.group_jid,
        "query": body.query,
        "image_bytes": image_bytes,
        "image_mime": body.image_mime,
        "whatsapp_message_id": body.whatsapp_message_id,
        "sender_name": body.sender_name,
        "sender_phone": body.sender_phone,
        "was_mentioned": body.was_mentioned,
        "is_reply_to_bot": body.is_reply_to_bot,
        "agent_results": [],
        "context": context,
        "response": None,
        "error": None,
    }

    thread_id = body.thread_id or body.group_jid or body.household_id
    config = {"configurable": {"thread_id": thread_id}}

    g = get_graph(with_memory=True)
    result = await asyncio.to_thread(g.invoke, state, config)

    # Only the reply the bot actually sends back through this response goes in
    # here. Anything a node pushed out mid-run (a pantry confirmation prompt,
    # for instance) was already recorded by services/whatsapp_client.py as it
    # was sent, so it lands in the transcript in the order the group saw it.
    if result.get("response"):
        await asyncio.to_thread(
            conversation.record_assistant_message,
            body.household_id,
            body.group_jid,
            result["response"],
            result.get("message_type"),
        )

    return {
        "response": result.get("response"),
        "message_type": result.get("message_type"),
        "error": result.get("error"),
    }
