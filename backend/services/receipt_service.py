"""
Shared receipt persistence logic used by both the /process-receipt API endpoint
and the LangGraph receipt_node.
"""
import uuid
import logging
from datetime import date
from services.db import get_supabase

from agents.receipt_agent import analyse_receipt
from services.reimbursement import get_reimbursable

logger = logging.getLogger(__name__)

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
    return _supabase


def _week_for_date(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return iso.week, iso.year


def upload_receipt_image(
    file_bytes: bytes, mime_type: str, household_id: str
) -> "tuple[str | None, str | None]":
    """Upload to the `receipts` bucket. Returns (path, error).

    A failure here must not lose the receipt -- the OCR data is the valuable
    part -- but it is not cosmetic either: the receipt then has no viewable
    image in the dashboard. Returning the reason keeps that diagnosable
    instead of vanishing into a log line.
    """
    try:
        ext = mime_type.split("/")[-1].replace("jpeg", "jpg")
        today = date.today().isoformat()
        filename = f"{uuid.uuid4().hex}.{ext}"
        path = f"{household_id}/{today}/{filename}"
        _db().storage.from_("receipts").upload(
            path=path,
            file=file_bytes,
            file_options={"content-type": mime_type, "upsert": "false"},
        )
        return path, None
    except Exception as e:
        logger.error(
            f"[receipt_service] image upload failed for household {household_id} "
            f"({mime_type}, {len(file_bytes)} bytes): {e}"
        )
        return None, str(e)


def save_receipt(
    image_bytes: bytes,
    mime_type: str,
    household_id: str,
    whatsapp_message_id: str | None = None,
    sender_name: str | None = None,
    sender_phone: str | None = None,
    user_id: str | None = None,
    settings: dict | None = None,
) -> dict:
    """OCR-analyse and persist a receipt. Returns the same shape as /process-receipt."""
    if not whatsapp_message_id:
        whatsapp_message_id = f"web-{uuid.uuid4().hex}"

    # Dedup.
    # household-scope: ok — and it must NOT be scoped, for the same reason as
    # the webhook path: whatsapp_message_id is UNIQUE table-wide, so a scoped
    # lookup would miss a duplicate and hit the constraint instead. Existence
    # only; no row is returned to a caller.
    existing = _db().table("receipts") \
        .select("id") \
        .eq("whatsapp_message_id", whatsapp_message_id) \
        .execute()
    if existing.data:
        return {"status": "duplicate", "receipt_id": existing.data[0]["id"]}

    # Reimbursable flag
    reimbursable = True
    if settings:
        reimbursable = get_reimbursable(sender_name, sender_phone, settings)

    image_path, image_error = upload_receipt_image(image_bytes, mime_type, household_id)
    analysis = analyse_receipt(image_bytes, mime_type=mime_type)

    if "error" in analysis and "vendor" not in analysis:
        logger.error(
            f"[receipt_service] OCR failed for household {household_id} "
            f"({mime_type}, {len(image_bytes)} bytes): {analysis['error']}"
        )
        return {"status": "error", "error": analysis["error"], "flagged": True}

    receipt_date = date.today()
    date_note = None
    if analysis.get("date"):
        try:
            parsed_date = date.fromisoformat(analysis["date"])
            today = date.today()
            if parsed_date > today or parsed_date < today.replace(year=today.year - 2):
                date_note = (
                    f"OCR date suspicious (read as {parsed_date.isoformat()}), "
                    f"defaulted to upload date"
                )
                analysis["flagged"] = True
            else:
                receipt_date = parsed_date
        except ValueError:
            pass

    week_num, year = _week_for_date(receipt_date)

    receipt_row = {
        "user_id":             user_id,
        "household_id":        household_id,
        "vendor":              analysis.get("vendor"),
        "date":                receipt_date.isoformat(),
        "subtotal":            analysis.get("subtotal"),
        "tax":                 analysis.get("tax"),
        "total":               analysis.get("total"),
        "currency":            analysis.get("currency", "SGD"),
        "confidence":          analysis.get("confidence", "medium"),
        "notes":               f"{analysis['notes']}; {date_note}" if analysis.get("notes") and date_note
                               else date_note or analysis.get("notes"),
        "whatsapp_message_id": whatsapp_message_id,
        "week_number":         week_num,
        "year":                year,
        "flagged":             analysis.get("flagged", False),
        "sender_name":         sender_name,
        "sender_phone":        sender_phone,
        "reimbursable":        reimbursable,
        "image_path":          image_path,
    }

    receipt_res = _db().table("receipts").insert(receipt_row).execute()
    receipt_id = receipt_res.data[0]["id"]

    inserted_items: list = []
    items = analysis.get("items") or []
    if items:
        item_rows = [
            {
                "receipt_id":     receipt_id,
                "household_id":   household_id,
                "name":           item.get("name"),
                "canonical_name": (item.get("canonical_name") or item.get("name") or "").strip().lower() or None,
                "brand":          item.get("brand"),
                "variant":        item.get("variant"),
                "qty":            item.get("qty", 1),
                "unit_price":     item.get("unit_price"),
                "line_total":     item.get("line_total"),
                "category":       item.get("category", "other"),
                "vendor":         analysis.get("vendor"),
                "receipt_date":   receipt_date.isoformat(),
                "week_number":    week_num,
                "year":           year,
            }
            for item in items if item.get("name")
        ]
        if item_rows:
            items_res = _db().table("items").insert(item_rows).execute()
            inserted_items = items_res.data or []

            price_history_rows = []
            for ins in inserted_items:
                canonical = ins.get("canonical_name") or (ins.get("name") or "").strip().lower() or None
                if not canonical or ins.get("unit_price") is None:
                    continue
                price_history_rows.append({
                    "household_id":   household_id,
                    "receipt_id":     receipt_id,
                    "item_id":        ins["id"],
                    "canonical_name": canonical,
                    "brand":          ins.get("brand"),
                    "variant":        ins.get("variant"),
                    "category":       ins.get("category"),
                    "vendor":         ins.get("vendor"),
                    "unit_price":     ins.get("unit_price"),
                    "quantity":       ins.get("qty") or 1,
                    "bought_at":      receipt_date.isoformat(),
                })
            if price_history_rows:
                _db().table("price_history").insert(price_history_rows).execute()

    return {
        "status":     "ok",
        "receipt_id": receipt_id,
        "vendor":     analysis.get("vendor"),
        "total":      analysis.get("total"),
        "confidence": analysis.get("confidence"),
        "flagged":    analysis.get("flagged"),
        "week":       week_num,
        "year":       year,
        "items":      inserted_items,
        "image_path": image_path,
        "image_error": image_error,
    }
