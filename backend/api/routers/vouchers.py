"""Voucher wallet — dashboard endpoints (JWT).

Thin on purpose: every rule (what "expired" means, dedup, value labels) is in
services/vouchers.py, shared with the WhatsApp paths (homly_graph.py's
voucher_node, agents/query/vouchers_agent.py). The page only renders what
these return, including `effective_status`, `days_left` and `expiring_soon`.
"""
import logging
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from agents.voucher_agent import extract_from_image, extract_from_text
from services import documents, vouchers
from services.household_time import household_today

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_MIME = {"image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"}
MAX_SIZE = 10 * 1024 * 1024  # 10 MB


class VoucherIn(BaseModel):
    merchant: str
    title: Optional[str] = None
    code: Optional[str] = None
    kind: Optional[str] = None
    value_type: Optional[str] = None
    value: Optional[float] = None
    currency: Optional[str] = None
    min_spend: Optional[float] = None
    terms: Optional[str] = None
    expires_at: Optional[str] = None
    # From POST /vouchers/extract, when the voucher was read from an upload.
    image_path: Optional[str] = None
    confidence: Optional[str] = None


class VoucherPatch(BaseModel):
    merchant: Optional[str] = None
    title: Optional[str] = None
    code: Optional[str] = None
    kind: Optional[str] = None
    value_type: Optional[str] = None
    value: Optional[float] = None
    currency: Optional[str] = None
    min_spend: Optional[float] = None
    terms: Optional[str] = None
    expires_at: Optional[str] = None
    status: Optional[str] = None


def _household_id(request: Request) -> str:
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    return household_id


@router.get("/vouchers")
def list_vouchers(request: Request, status: str = "active"):
    """status: active (the wallet), history (used + expired + archived), all."""
    if status not in ("active", "history", "all", "used", "expired", "archived"):
        raise HTTPException(status_code=422, detail="Invalid status")
    household_id = _household_id(request)
    rows = vouchers.list_vouchers(household_id, status)
    return {
        "vouchers": rows,
        "expiring_soon_days": vouchers.EXPIRING_SOON_DAYS,
        "counts": {
            "active": sum(1 for r in rows if r["effective_status"] == "active"),
            "expiring_soon": sum(1 for r in rows if r["expiring_soon"]),
        },
    }


@router.post("/vouchers/extract")
async def extract_voucher(
    request: Request,
    file: Optional[UploadFile] = File(None),
    text: Optional[str] = Form(None),
):
    """Read a voucher from an uploaded image/PDF or pasted text. Nothing is
    saved as a voucher yet — the page shows the result for review and then
    POSTs /vouchers. An uploaded image is stored now so the saved voucher can
    keep it (a barcode/QR voucher *is* its image)."""
    household_id = _household_id(request)
    today = household_today(household_id)

    if file is None and not (text or "").strip():
        raise HTTPException(status_code=422, detail="Upload an image or paste the promo text")

    image_path = None
    image_url = None
    if file is not None:
        mime = (file.content_type or "").lower()
        if mime not in ALLOWED_MIME:
            raise HTTPException(status_code=400, detail="Unsupported file type. Allowed: JPEG, PNG, WEBP, PDF")
        blob = await file.read()
        if len(blob) > MAX_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 10 MB)")
        extracted = extract_from_image(blob, mime, today=today)
        image_path = documents.upload_image(blob, mime, household_id, bucket=vouchers.BUCKET)
        image_url = documents.signed_url(image_path, bucket=vouchers.BUCKET)
    else:
        extracted = extract_from_text(text or "", today=today)

    found = bool(extracted.get("is_voucher"))
    return {
        "found": found,
        "extracted": vouchers.normalize(extracted) if found else None,
        "confidence": extracted.get("confidence") if found else None,
        "image_path": image_path,
        "image_url": image_url,
        "error": extracted.get("error"),
    }


@router.post("/vouchers", status_code=201)
def create_voucher(request: Request, body: VoucherIn):
    household_id = _household_id(request)
    data = body.model_dump()
    image_path = data.pop("image_path", None)
    confidence = data.pop("confidence", None)
    # The path came back from /vouchers/extract via the browser — only accept
    # one inside this household's own folder.
    if image_path and not image_path.startswith(f"{household_id}/"):
        raise HTTPException(status_code=400, detail="Invalid image")

    row, created, error = vouchers.create_voucher(
        household_id, data,
        source="dashboard",
        image_path=image_path,
        confidence=confidence,
        created_by=request.state.user.get("sub"),
    )
    if error:
        raise HTTPException(status_code=422, detail=error)
    if not created and image_path and row and row.get("image_path") != image_path:
        vouchers.discard_image(image_path)
    return {"voucher": row, "created": created}


@router.patch("/vouchers/{voucher_id}")
def update_voucher(voucher_id: str, request: Request, body: VoucherPatch):
    household_id = _household_id(request)
    data = body.model_dump(exclude_unset=True)
    try:
        row = vouchers.update_voucher(household_id, voucher_id, data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if not row:
        raise HTTPException(status_code=404, detail="Voucher not found")
    return {"voucher": row}


@router.post("/vouchers/{voucher_id}/use")
def use_voucher(voucher_id: str, request: Request):
    household_id = _household_id(request)
    row = vouchers.mark_used(household_id, voucher_id)
    if not row:
        raise HTTPException(status_code=404, detail="Voucher not found")
    return {"voucher": row}


@router.delete("/vouchers/{voucher_id}")
def delete_voucher(voucher_id: str, request: Request):
    household_id = _household_id(request)
    if not vouchers.delete_voucher(household_id, voucher_id):
        raise HTTPException(status_code=404, detail="Voucher not found")
    return {"deleted": True}


@router.get("/vouchers/{voucher_id}/image")
def voucher_image(voucher_id: str, request: Request):
    household_id = _household_id(request)
    row = vouchers.get_voucher(household_id, voucher_id)
    if not row:
        raise HTTPException(status_code=404, detail="Voucher not found")
    url = documents.signed_url(row.get("image_path"), bucket=vouchers.BUCKET)
    if not url:
        raise HTTPException(status_code=404, detail="No image for this voucher")
    return {"url": url}
