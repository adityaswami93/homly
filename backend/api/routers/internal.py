from fastapi import APIRouter, Request, HTTPException
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
    return {"qr_requested": requested}
