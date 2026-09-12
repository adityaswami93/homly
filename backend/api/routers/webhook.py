import asyncio
import os
import re
import uuid
import logging
from datetime import date

from fastapi import APIRouter, Request
from services.db import get_supabase

from agents.receipt_agent import analyse_receipt
from services.whatsapp_client import send_text, download_file
from services.reimbursement import get_reimbursable
from services.internal_auth import has_internal_key

logger = logging.getLogger(__name__)
router = APIRouter()

IMAGE_MIME_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"}

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
    return _supabase


def _week_for_date(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return iso.week, iso.year


def _upload_image(image_bytes: bytes, mime_type: str, household_id: str) -> str | None:
    try:
        ext = mime_type.split("/")[-1].replace("jpeg", "jpg")
        today = date.today().isoformat()
        filename = f"{uuid.uuid4().hex}.{ext}"
        path = f"{household_id}/{today}/{filename}"
        _db().storage.from_("receipts").upload(
            path=path,
            file=image_bytes,
            file_options={"content-type": mime_type, "upsert": "false"},
        )
        return path
    except Exception as e:
        logger.error(f"[webhook] Image upload failed: {e}")
        return None


@router.post("/webhook/whatsapp")
async def whatsapp_webhook(request: Request):
    try:
        body = await request.json()
    except Exception:
        return {"status": "error"}

    if body.get("typeWebhook") != "incomingMessageReceived":
        return {"status": "ignored"}

    # Auth: internal bot key (Baileys) OR Green API instance ID.
    # This route is in SKIP_AUTH_PATHS, so this check is the only thing in
    # front of it — and it writes receipts against a household_id resolved
    # from the payload's own chat id.
    if not has_internal_key(request):
        # `expected` must be non-empty before comparing: with
        # GREEN_API_INSTANCE_ID unset this read `"" != ""` → False, so a
        # payload carrying no instanceData at all authenticated successfully.
        expected_instance = (os.getenv("GREEN_API_INSTANCE_ID") or "").strip()
        instance_id = str(body.get("instanceData", {}).get("idInstance", "")).strip()
        if not expected_instance or not instance_id or instance_id != expected_instance:
            return {"status": "ignored"}

    sender_data = body.get("senderData", {})
    chat_id = sender_data.get("chatId", "")
    sender_name = sender_data.get("senderName") or None
    sender_jid = sender_data.get("sender", "")
    sender_phone = sender_jid.split("@")[0] if "@" in sender_jid else None
    msg_id = body.get("idMessage", "")
    message_data = body.get("messageData", {})
    msg_type = message_data.get("typeMessage", "")

    # Only handle messages from tracked groups
    if not chat_id.endswith("@g.us"):
        return {"status": "ignored"}

    res = _db().table("settings").select(
        "household_id, cutoff_mode, reimbursement_mode, helper_identifiers"
    ).eq("group_jid", chat_id).execute()

    if not res.data:
        return {"status": "ignored"}

    settings = res.data[0]
    household_id = settings["household_id"]

    if msg_type == "textMessage":
        text = (message_data.get("textMessageData", {}).get("textMessage") or "").strip().lower()
        await _handle_text(chat_id, household_id, text, settings)

    elif msg_type == "imageMessage":
        file_data = message_data.get("fileMessageData", {})
        download_url = file_data.get("downloadUrl")
        mime_type = (file_data.get("mimeType") or "image/jpeg").lower()
        if download_url and mime_type in IMAGE_MIME_TYPES:
            await _handle_image(
                chat_id, household_id, msg_id,
                download_url, mime_type,
                sender_name, sender_phone, settings,
            )

    return {"status": "ok"}


async def _handle_text(chat_id: str, household_id: str, text: str, settings: dict):
    if not _is_query(text):
        return

    from agents.router_agent import run_query

    result = await asyncio.to_thread(run_query, text, household_id)
    if result.handled:
        await send_text(chat_id, result.response)
    elif "summary" in text or "/summary" in text:
        # Fallback: explicit /summary command the engine doesn't handle
        from api.routers.messages import build_last7days_total, build_week_total
        mode = settings.get("cutoff_mode", "last7days")
        msg = (
            await build_last7days_total(household_id)
            if mode == "last7days"
            else await build_week_total(household_id)
        )
        await send_text(chat_id, msg)


def _is_query(text: str) -> bool:
    t = text.strip()
    if not t or len(t) < 5 or len(t) > 400:
        return False
    if t.endswith("?"):
        return True
    if re.match(
        r"^(what|how|when|where|who|which|show|tell|list|find|give|total|"
        r"summarize|summarise|compare|any|are|is|do|did|have|has)\b",
        t,
        re.IGNORECASE,
    ):
        return True
    return False


async def _handle_image(
    chat_id: str,
    household_id: str,
    msg_id: str,
    download_url: str,
    mime_type: str,
    sender_name: str | None,
    sender_phone: str | None,
    settings: dict,
):
    # Dedup check
    existing = _db().table("receipts").select("id").eq("whatsapp_message_id", msg_id).execute()
    if existing.data:
        return

    image_bytes = await download_file(download_url)
    if not image_bytes:
        await send_text(chat_id, "Failed to download image — please try again.")
        return

    image_path = _upload_image(image_bytes, mime_type, household_id)
    analysis = analyse_receipt(image_bytes, mime_type)

    if "error" in analysis and "vendor" not in analysis:
        await send_text(chat_id, "Could not read the receipt — please try a clearer photo.")
        return

    receipt_date = date.today()
    if analysis.get("date"):
        try:
            receipt_date = date.fromisoformat(analysis["date"])
        except ValueError:
            pass

    week_num, year = _week_for_date(receipt_date)
    reimbursable = get_reimbursable(sender_name, sender_phone, settings)

    receipt_row = {
        "household_id":        household_id,
        "vendor":              analysis.get("vendor"),
        "date":                receipt_date.isoformat(),
        "subtotal":            analysis.get("subtotal"),
        "tax":                 analysis.get("tax"),
        "total":               analysis.get("total"),
        "currency":            analysis.get("currency", "SGD"),
        "confidence":          analysis.get("confidence", "medium"),
        "notes":               analysis.get("notes"),
        "whatsapp_message_id": msg_id,
        "week_number":         week_num,
        "year":                year,
        "flagged":             analysis.get("flagged", False),
        "sender_name":         sender_name,
        "sender_phone":        sender_phone,
        "reimbursable":        reimbursable,
        "image_path":          image_path,
        "deleted":             False,
    }

    receipt_res = _db().table("receipts").insert(receipt_row).execute()
    if not receipt_res.data:
        logger.error(f"[webhook] Failed to insert receipt for msg {msg_id}")
        return

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

    vendor = analysis.get("vendor") or "unknown"
    total = analysis.get("total")
    flagged = analysis.get("flagged")

    if flagged:
        amt = f"SGD {total}" if total else "amount unclear"
        await send_text(chat_id, f"Receipt captured but needs a manual check.\nVendor: {vendor}, Total: {amt}")
    else:
        amt = f"SGD {float(total):.2f}" if total else "amount unclear"
        await send_text(chat_id, f"Receipt saved. {vendor} — {amt}")

    logger.info(f"[webhook] Receipt {receipt_id}: {vendor}, total={total}, confidence={analysis.get('confidence')}")


