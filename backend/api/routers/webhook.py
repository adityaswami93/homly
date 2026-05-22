import os
import uuid
import logging
from datetime import date

from fastapi import APIRouter, Request
from supabase import create_client

from agents.receipt_agent import analyse_receipt
from services.whatsapp_client import send_text, download_file

logger = logging.getLogger(__name__)
router = APIRouter()

IMAGE_MIME_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"}
INSURANCE_KEYWORDS = [
    "insurance", "policy", "policies",
    "health insurance", "life insurance", "car insurance",
    "home insurance", "travel insurance",
]

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


def _week_for_date(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return iso.week, iso.year


def _get_reimbursable(sender_name: str | None, sender_phone: str | None, settings: dict) -> bool:
    mode = settings.get("reimbursement_mode", "all")
    if mode == "all":
        return True
    if mode == "none":
        return False
    if mode == "helpers_only":
        identifiers = settings.get("helper_identifiers", "") or ""
        if not identifiers:
            return False
        helper_list = [h.strip().lower() for h in identifiers.split(",") if h.strip()]
        return bool(
            (sender_name and sender_name.lower() in helper_list)
            or (sender_phone and sender_phone in helper_list)
        )
    return True


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

    # Auth: internal bot key (Baileys) OR Green API instance ID
    internal_key = request.headers.get("X-Internal-Key")
    is_internal = internal_key and internal_key == os.getenv("INTERNAL_KEY", "homly-internal")

    if not is_internal:
        instance_id = str(body.get("instanceData", {}).get("idInstance", ""))
        if instance_id != os.getenv("GREEN_API_INSTANCE_ID", ""):
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
    if any(kw in text for kw in INSURANCE_KEYWORDS):
        await _handle_insurance_query(chat_id, household_id, text)
        return

    if "summary" in text or "/summary" in text:
        from api.routers.messages import build_last7days_total, build_week_total
        mode = settings.get("cutoff_mode", "last7days")
        msg = (
            await build_last7days_total(household_id)
            if mode == "last7days"
            else await build_week_total(household_id)
        )
        await send_text(chat_id, msg)


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
    reimbursable = _get_reimbursable(sender_name, sender_phone, settings)

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


async def _handle_insurance_query(chat_id: str, household_id: str, text: str):
    try:
        res = (
            _db().table("insurance_policies")
            .select("*")
            .eq("household_id", household_id)
            .eq("is_active", True)
            .order("coverage_type")
            .execute()
        )
        all_policies = res.data or []

        coverage_types = ["health", "life", "home", "car", "travel"]
        type_filter = next((t for t in coverage_types if t in text), None)
        policies = [p for p in all_policies if p["coverage_type"] == type_filter] if type_filter else all_policies

        if not policies:
            await send_text(
                chat_id,
                "No insurance policies added yet. Visit the Homly dashboard to add your policies.",
            )
            return

        today = date.today()
        grouped: dict[str, list] = {}
        for p in policies:
            grouped.setdefault(p["coverage_type"], []).append(p)

        lines = ["🛡️ *Household Insurance Policies*", ""]
        for ctype, items in grouped.items():
            lines.append(f"*{ctype.upper()}*")
            for p in items:
                line = f"- {p['provider']}"
                if p.get("insured_person"):
                    line += f" ({p['insured_person']})"
                lines.append(line)
                if p.get("policy_number"):
                    lines.append(f"  Policy #: {p['policy_number']}")
                coverage = f"${float(p['coverage_amount']):,.0f}" if p.get("coverage_amount") else "—"
                premium = f"${float(p['premium_amount']):.0f}/{p.get('premium_frequency', 'mo')}" if p.get("premium_amount") else "—"
                lines.append(f"  Coverage: {coverage} | Premium: {premium}")
                if p.get("renewal_date"):
                    renewal = date.fromisoformat(p["renewal_date"])
                    days = (renewal - today).days
                    date_str = renewal.strftime("%-d %b %Y")
                    lines.append(f"  Renews: {date_str} ({'overdue' if days <= 0 else f'{days} days'})")
            lines.append("")

        if not type_filter:
            lines.append('Reply with a type to filter, e.g. "health insurance"')

        await send_text(chat_id, "\n".join(lines).strip())
    except Exception as e:
        logger.error(f"[webhook] Insurance query failed: {e}")
