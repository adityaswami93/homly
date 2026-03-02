import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form, Query
from typing import Optional
from supabase import create_client
from datetime import date, timedelta
from isoweek import Week
import logging

from api.dependencies.limiter import limiter
from agents.receipt_agent import analyse_receipt

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


@router.post("/process-receipt")
@limiter.limit("60/minute")
async def process_receipt(
    request: Request,
    file: UploadFile = File(...),
    whatsapp_message_id: str = Form(...),
    user_id: Optional[str] = Form(default=None),
    sender_name: Optional[str] = Form(default=None),
    sender_phone: Optional[str] = Form(default=None),
    household_id: Optional[str] = Form(default=None),
):
    resolved_household = request.state.user.get("household_id")
    if not resolved_household:
        if request.state.user.get("is_service_key"):
            resolved_household = household_id
        if not resolved_household:
            raise HTTPException(status_code=403, detail="No household found")
    household_id = resolved_household

    existing = _db().table("receipts")\
        .select("id")\
        .eq("whatsapp_message_id", whatsapp_message_id)\
        .execute()
    if existing.data:
        return {"status": "duplicate", "receipt_id": existing.data[0]["id"]}

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10 MB)")

    content_type = file.content_type or "image/jpeg"
    analysis = analyse_receipt(image_bytes, mime_type=content_type)

    if "error" in analysis and "vendor" not in analysis:
        raise HTTPException(status_code=422, detail=f"OCR failed: {analysis['error']}")

    receipt_date = None
    if analysis.get("date"):
        try:
            receipt_date = date.fromisoformat(analysis["date"])
        except ValueError:
            receipt_date = date.today()
    else:
        receipt_date = date.today()

    week_num, year = _week_for_date(receipt_date)

    receipt_row = {
        "user_id":              user_id,
        "household_id":         household_id,
        "vendor":               analysis.get("vendor"),
        "date":                 receipt_date.isoformat(),
        "subtotal":             analysis.get("subtotal"),
        "tax":                  analysis.get("tax"),
        "total":                analysis.get("total"),
        "currency":             analysis.get("currency", "SGD"),
        "confidence":           analysis.get("confidence", "medium"),
        "notes":                analysis.get("notes"),
        "image_filename":       file.filename,
        "whatsapp_message_id":  whatsapp_message_id,
        "week_number":          week_num,
        "year":                 year,
        "flagged":              analysis.get("flagged", False),
        "sender_name":          sender_name or None,
        "sender_phone":         sender_phone or None,
    }

    receipt_res = _db().table("receipts").insert(receipt_row).execute()
    receipt_id = receipt_res.data[0]["id"]

    items = analysis.get("items") or []
    if items:
        item_rows = [
            {
                "receipt_id":   receipt_id,
                "household_id": household_id,
                "name":         item.get("name"),
                "qty":          item.get("qty", 1),
                "unit_price":   item.get("unit_price"),
                "line_total":   item.get("line_total"),
                "category":     item.get("category", "other"),
                "vendor":       analysis.get("vendor"),
                "receipt_date": receipt_date.isoformat(),
                "week_number":  week_num,
                "year":         year,
            }
            for item in items if item.get("name")
        ]
        if item_rows:
            _db().table("items").insert(item_rows).execute()

    return {
        "status":     "ok",
        "receipt_id": receipt_id,
        "vendor":     analysis.get("vendor"),
        "total":      analysis.get("total"),
        "confidence": analysis.get("confidence"),
        "flagged":    analysis.get("flagged"),
        "week":       week_num,
        "year":       year,
    }


@router.get("/weeks")
def list_weeks(request: Request):
    user_id      = request.state.user["sub"]
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    res = _db().table("receipts")\
        .select("year, week_number")\
        .eq("household_id", household_id)\
        .eq("deleted",     False)\
        .order("year",        desc=True)\
        .order("week_number", desc=True)\
        .execute()

    seen = set()
    weeks = []
    for row in res.data:
        key = (row["year"], row["week_number"])
        if key not in seen:
            seen.add(key)
            w = Week(row["year"], row["week_number"])
            weeks.append({
                "year":        row["year"],
                "week_number": row["week_number"],
                "week_start":  w.monday().isoformat(),
                "week_end":    w.sunday().isoformat(),
            })
    return weeks


@router.get("/weeks/{year}/{week_number}")
def get_week(year: int, week_number: int, request: Request):
    user_id      = request.state.user["sub"]
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

    category_totals: dict[str, float] = {}
    for item in items_data:
        cat = item["category"] or "other"
        category_totals[cat] = round(
            category_totals.get(cat, 0) + (item["line_total"] or 0), 2
        )

    total = sum(r["total"] or 0 for r in receipts_res.data)
    flagged_count = sum(1 for r in receipts_res.data if r.get("flagged"))

    return {
        "year":             year,
        "week_number":      week_number,
        "total":            round(total, 2),
        "receipt_count":    len(receipts_res.data),
        "flagged_count":    flagged_count,
        "receipts":         receipts_res.data,
        "category_totals":  category_totals,
    }


@router.get("/receipts/{receipt_id}")
def get_receipt(receipt_id: str, request: Request):
    user_id      = request.state.user["sub"]
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
    user_id      = request.state.user["sub"]
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
    user_id      = request.state.user["sub"]
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
        for item in items_res.data:
            cat = item["category"] or "other"
            category_totals[cat] = round(
                category_totals.get(cat, 0) + (item["line_total"] or 0), 2
            )

    total = sum(r["total"] or 0 for r in receipts_res.data)
    flagged_count = sum(1 for r in receipts_res.data if r.get("flagged"))

    return {
        "date_from":       date_from.isoformat(),
        "date_to":         today.isoformat(),
        "total":           round(total, 2),
        "receipt_count":   len(receipts_res.data),
        "flagged_count":   flagged_count,
        "receipts":        receipts_res.data,
        "category_totals": category_totals,
    }
