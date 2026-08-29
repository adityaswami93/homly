import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form, Query
from typing import Optional
from supabase import create_client
from datetime import date, timedelta
import logging

from api.dependencies.limiter import limiter
from services.receipts import compute_category_totals
from services.reimbursement import compute_reimbursement_totals, mark_receipts_reimbursed

logger = logging.getLogger(__name__)
router = APIRouter()


_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


def _week_for_date(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return iso.week, iso.year


ACCEPTED_MIME_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic",
    "application/pdf",
}


@router.post("/process-receipt")
@limiter.limit("60/minute")
async def process_receipt(
    request: Request,
    file: UploadFile = File(...),
    whatsapp_message_id: Optional[str] = Form(default=None),
    user_id: Optional[str] = Form(default=None),
    sender_name: Optional[str] = Form(default=None),
    sender_phone: Optional[str] = Form(default=None),
    household_id: Optional[str] = Form(default=None),
    group_jid: Optional[str] = Form(default=None),
):
    resolved_household = request.state.user.get("household_id")
    if not resolved_household and request.state.user.get("is_service_key"):
        resolved_household = household_id
        if not resolved_household and group_jid:
            s = _db().table("settings").select("household_id").eq("group_jid", group_jid).execute()
            resolved_household = s.data[0]["household_id"] if s.data else None
    if not resolved_household:
        raise HTTPException(status_code=403, detail="No household found")
    household_id = resolved_household

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    content_type = (file.content_type or "image/jpeg").lower().split(";")[0].strip()
    if content_type not in ACCEPTED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. Accepted: images and PDF."
        )

    from api.routers.settings import get_or_create_settings
    settings = get_or_create_settings(household_id)

    from services.receipt_service import save_receipt
    result = save_receipt(
        image_bytes=image_bytes,
        mime_type=content_type,
        household_id=household_id,
        whatsapp_message_id=whatsapp_message_id,
        sender_name=sender_name,
        sender_phone=sender_phone,
        user_id=user_id,
        settings=settings,
    )

    if result.get("status") == "error":
        raise HTTPException(status_code=422, detail=f"OCR failed: {result.get('error')}")

    return result


@router.get("/weeks")
def list_weeks(request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    receipts_res = _db().table("receipts")\
        .select("year, week_number, total, reimbursable, reimbursement_id, flagged")\
        .eq("household_id", household_id)\
        .eq("deleted", False)\
        .order("year",        desc=True)\
        .order("week_number", desc=True)\
        .execute()

    # Group by week
    weeks: dict[str, dict] = {}
    week_receipts: dict[str, list[dict]] = {}
    for r in receipts_res.data:
        key = f"{r['year']}-{r['week_number']}"
        if key not in weeks:
            weeks[key] = {
                "year":          r["year"],
                "week_number":   r["week_number"],
                "total":         0,
                "receipt_count": 0,
                "flagged_count": 0,
            }
            week_receipts[key] = []
        weeks[key]["total"]         += r["total"] or 0
        weeks[key]["receipt_count"] += 1
        weeks[key]["flagged_count"] += 1 if r.get("flagged") else 0
        week_receipts[key].append(r)

    result = []
    for key, w in weeks.items():
        result.append({
            **w,
            "total": round(w["total"], 2),
            **compute_reimbursement_totals(week_receipts[key]),
        })

    return result


@router.get("/weeks/{year}/{week_number}")
def get_week(year: int, week_number: int, request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    receipts_res = _db().table("receipts")\
        .select("*")\
        .eq("household_id", household_id)\
        .eq("year",        year)\
        .eq("week_number", week_number)\
        .eq("deleted",     False)\
        .order("date",     desc=False)\
        .execute()

    receipt_ids = [r["id"] for r in receipts_res.data]
    if receipt_ids:
        items_res = _db().table("items")\
            .select("category, line_total, receipt_id")\
            .in_("receipt_id", receipt_ids)\
            .execute()
        items_data = items_res.data
    else:
        items_data = []

    category_totals = compute_category_totals(items_data)

    total = sum(r["total"] or 0 for r in receipts_res.data)
    flagged_count = sum(1 for r in receipts_res.data if r.get("flagged"))

    return {
        "year":            year,
        "week_number":     week_number,
        "total":           round(total, 2),
        "own_total":       round(sum(r["total"] or 0 for r in receipts_res.data if not r.get("reimbursable")), 2),
        "receipt_count":   len(receipts_res.data),
        "flagged_count":   flagged_count,
        "receipts":        receipts_res.data,
        "category_totals": category_totals,
        **compute_reimbursement_totals(receipts_res.data),
    }


@router.get("/receipts/daterange")
def get_receipts_by_daterange(start: str, end: str, request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    receipts_res = _db().table("receipts")\
        .select("*")\
        .eq("household_id", household_id)\
        .eq("deleted", False)\
        .gte("date", start)\
        .lte("date", end)\
        .order("date", desc=False)\
        .execute()

    receipt_ids = [r["id"] for r in receipts_res.data]
    if receipt_ids:
        items_res = _db().table("items")\
            .select("category, line_total, receipt_id")\
            .in_("receipt_id", receipt_ids)\
            .execute()
        items_data = items_res.data
    else:
        items_data = []

    category_totals = compute_category_totals(items_data)

    total = sum(r["total"] or 0 for r in receipts_res.data)
    flagged_count = sum(1 for r in receipts_res.data if r.get("flagged"))
    totals = compute_reimbursement_totals(receipts_res.data)

    return {
        "start_date":                     start,
        "end_date":                       end,
        "total":                          round(total, 2),
        "reimbursable_total":             totals["reimbursable_total"],
        "already_paid":                   totals["paid_reimbursable_total"],
        "outstanding_reimbursable_total": totals["outstanding_reimbursable_total"],
        "own_total":                      round(sum(r["total"] or 0 for r in receipts_res.data if not r.get("reimbursable")), 2),
        "receipt_count":                  len(receipts_res.data),
        "flagged_count":                  flagged_count,
        "receipts":                       receipts_res.data,
        "category_totals":                category_totals,
    }


@router.post("/receipts/daterange/mark-paid")
def mark_daterange_paid(request: Request, body: dict):
    """Settle every currently-unpaid reimbursable receipt in [start, end]
    with a single reimbursement, recorded directly on those receipts (see
    services/reimbursement.py's mark_receipts_reimbursed)."""
    household_id = request.state.user.get("household_id")
    user_id      = request.state.user.get("sub")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    start = body.get("start")
    end   = body.get("end")
    if not start or not end:
        raise HTTPException(status_code=400, detail="start and end required")

    receipts_res = _db().table("receipts")\
        .select("id, date, total, reimbursable, reimbursement_id")\
        .eq("household_id", household_id)\
        .eq("deleted", False)\
        .gte("date", start)\
        .lte("date", end)\
        .execute()

    result = mark_receipts_reimbursed(
        _db(), household_id, receipts_res.data,
        note=f"Reimbursement for {start} to {end}", created_by=user_id,
    )

    return {"amount_paid": result["amount"] if result else 0}


@router.get("/receipts/{receipt_id}")
def get_receipt(receipt_id: str, request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    receipt_res = _db().table("receipts")\
        .select("*")\
        .eq("id",           receipt_id)\
        .eq("household_id", household_id)\
        .execute()

    if not receipt_res.data:
        raise HTTPException(status_code=404, detail="Receipt not found")

    items_res = _db().table("items")\
        .select("*")\
        .eq("receipt_id", receipt_id)\
        .execute()

    return {**receipt_res.data[0], "items": items_res.data}


@router.patch("/receipts/{receipt_id}/flag")
def toggle_flag(receipt_id: str, request: Request, body: dict):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    existing = _db().table("receipts")\
        .select("household_id")\
        .eq("id", receipt_id)\
        .execute()
    if not existing.data or existing.data[0]["household_id"] != household_id:
        raise HTTPException(status_code=404, detail="Receipt not found")
    _db().table("receipts")\
        .update({"flagged": body.get("flagged", True)})\
        .eq("id", receipt_id)\
        .execute()
    return {"status": "ok"}


@router.patch("/receipts/{receipt_id}/delete")
def soft_delete_receipt(receipt_id: str, request: Request, body: dict):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    existing = _db().table("receipts")\
        .select("household_id")\
        .eq("id", receipt_id)\
        .execute()
    if not existing.data or existing.data[0]["household_id"] != household_id:
        raise HTTPException(status_code=404, detail="Receipt not found")
    _db().table("receipts")\
        .update({"deleted": body.get("deleted", True)})\
        .eq("id", receipt_id)\
        .execute()
    return {"status": "ok"}


@router.patch("/receipts/{receipt_id}/reimbursable")
def toggle_reimbursable(receipt_id: str, request: Request, body: dict):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    existing = _db().table("receipts")\
        .select("household_id")\
        .eq("id", receipt_id)\
        .execute()
    if not existing.data or existing.data[0]["household_id"] != household_id:
        raise HTTPException(status_code=404, detail="Receipt not found")
    _db().table("receipts")\
        .update({"reimbursable": body.get("reimbursable", True)})\
        .eq("id", receipt_id)\
        .execute()
    return {"status": "ok"}


@router.patch("/receipts/{receipt_id}/date")
def update_receipt_date(receipt_id: str, request: Request, body: dict):
    user         = request.state.user
    household_id = user.get("household_id")
    role         = user.get("role")
    is_super_admin = user.get("is_super_admin")

    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    if role != "admin" and not is_super_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    new_date_str = body.get("date")
    if not new_date_str:
        raise HTTPException(status_code=400, detail="date required")
    try:
        new_date = date.fromisoformat(new_date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format — use YYYY-MM-DD")

    existing = _db().table("receipts")\
        .select("household_id")\
        .eq("id", receipt_id)\
        .execute()
    if not existing.data or existing.data[0]["household_id"] != household_id:
        raise HTTPException(status_code=404, detail="Receipt not found")

    week_num, year = _week_for_date(new_date)

    _db().table("receipts").update({
        "date":        new_date.isoformat(),
        "week_number": week_num,
        "year":        year,
    }).eq("id", receipt_id).execute()

    _db().table("items").update({
        "receipt_date": new_date.isoformat(),
        "week_number":  week_num,
        "year":         year,
    }).eq("receipt_id", receipt_id).execute()

    return {"status": "ok", "date": new_date.isoformat(), "week_number": week_num, "year": year}


@router.get("/this-week")
def this_week(request: Request, household_id: Optional[str] = Query(default=None)):
    today = date.today()
    week_num, year = _week_for_date(today)
    # Inject service-key household_id into state so get_week can resolve it
    if not request.state.user.get("household_id") and request.state.user.get("is_service_key") and household_id:
        request.state.user["household_id"] = household_id
    return get_week(year, week_num, request)


@router.get("/summary/last7days")
def last_7_days(request: Request, household_id: Optional[str] = Query(default=None)):
    resolved = request.state.user.get("household_id")
    if not resolved and request.state.user.get("is_service_key"):
        resolved = household_id
    if not resolved:
        raise HTTPException(status_code=403, detail="No household found")
    household_id = resolved

    today = date.today()
    date_from = today - timedelta(days=6)  # last 7 days inclusive

    receipts_res = _db().table("receipts")\
        .select("*")\
        .eq("household_id", household_id)\
        .eq("deleted", False)\
        .gte("date", date_from.isoformat())\
        .lte("date", today.isoformat())\
        .order("date", desc=False)\
        .execute()

    receipt_ids = [r["id"] for r in receipts_res.data]
    category_totals: dict[str, float] = {}

    if receipt_ids:
        items_res = _db().table("items")\
            .select("category, line_total")\
            .in_("receipt_id", receipt_ids)\
            .execute()
        category_totals = compute_category_totals(items_res.data)

    total = sum(r["total"] or 0 for r in receipts_res.data)
    flagged_count = sum(1 for r in receipts_res.data if r.get("flagged"))

    return {
        "date_from":         date_from.isoformat(),
        "date_to":           today.isoformat(),
        "total":             round(total, 2),
        "reimbursable_total": round(sum(r["total"] or 0 for r in receipts_res.data if r.get("reimbursable")), 2),
        "own_total":          round(sum(r["total"] or 0 for r in receipts_res.data if not r.get("reimbursable")), 2),
        "receipt_count":     len(receipts_res.data),
        "flagged_count":     flagged_count,
        "receipts":          receipts_res.data,
        "category_totals":   category_totals,
    }


@router.get("/receipts/{receipt_id}/image")
def get_receipt_image_url(receipt_id: str, request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    receipt = _db().table("receipts")\
        .select("image_path, household_id")\
        .eq("id", receipt_id)\
        .execute()

    if not receipt.data:
        raise HTTPException(status_code=404, detail="Receipt not found")
    if receipt.data[0]["household_id"] != household_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    image_path = receipt.data[0].get("image_path")
    if not image_path:
        raise HTTPException(status_code=404, detail="No image stored for this receipt")

    # Generate signed URL valid for 60 minutes
    result = _db().storage.from_("receipts").create_signed_url(
        path=image_path,
        expires_in=3600,
    )
    return {"url": result["signedURL"]}
