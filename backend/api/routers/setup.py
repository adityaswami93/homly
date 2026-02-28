import os
import asyncio
import json
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

# Shared state between whatsapp process and API
whatsapp_state = {
    "qr": None,
    "connected": False,
    "group_name": None,
    "groups": [],
}


@router.get("/setup/state")
def get_state():
    return whatsapp_state


@router.post("/setup/group")
async def set_group(body: dict):
    whatsapp_state["group_name"] = body.get("group_name")
    # Write to a file so whatsapp process can pick it up
    with open("/tmp/homly_group.txt", "w") as f:
        f.write(body.get("group_name", ""))
    return {"status": "ok", "group_name": whatsapp_state["group_name"]}


@router.get("/setup/qr-stream")
async def qr_stream(request: Request):
    """Server-sent events stream for QR code updates"""
    async def event_generator():
        last_qr = None
        while True:
            if await request.is_disconnected():
                break
            qr = whatsapp_state.get("qr")
            connected = whatsapp_state.get("connected")
            if connected:
                yield f"data: {json.dumps({'type': 'connected'})}\n\n"
                break
            if qr and qr != last_qr:
                last_qr = qr
                yield f"data: {json.dumps({'type': 'qr', 'qr': qr})}\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
