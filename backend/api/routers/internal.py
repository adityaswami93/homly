from fastapi import APIRouter, Request, HTTPException
import os

router = APIRouter()

# In-memory state shared with setup router
from api.routers.setup import whatsapp_state

INTERNAL_KEY = os.getenv("INTERNAL_KEY", "homly-internal")


@router.post("/internal/qr")
async def receive_qr(request: Request, body: dict):
    key = request.headers.get("X-Internal-Key")
    if key != INTERNAL_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")
    whatsapp_state["qr"] = body.get("qr")
    whatsapp_state["connected"] = False
    return {"status": "ok"}


@router.post("/internal/connected")
async def receive_connected(request: Request, body: dict):
    key = request.headers.get("X-Internal-Key")
    if key != INTERNAL_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")
    whatsapp_state["connected"] = True
    whatsapp_state["qr"] = None
    whatsapp_state["groups"] = body.get("groups", [])
    return {"status": "ok"}


@router.get("/internal/qr-status")
async def qr_status(request: Request):
    """Bot polls this to check if a QR regeneration was requested"""
    key = request.headers.get("X-Internal-Key")
    if key != INTERNAL_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")
    requested = whatsapp_state.get("qr_requested", False)
    whatsapp_state["qr_requested"] = False  # clear after reading
    return {"qr_requested": requested}
