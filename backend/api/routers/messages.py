import os
import asyncio
from fastapi import APIRouter, Request, HTTPException
from supabase import create_client
from datetime import date, timedelta
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

# Shared message queue — whatsapp bot polls this
message_queue: list[dict] = []


@router.post("/messages/send")
async def send_message(request: Request, body: dict):
    user_id  = request.state.user["sub"]
    msg_type = body.get("type")

    if msg_type == "week_total":
        text = await build_week_total(user_id, body.get("year"), body.get("week_number"))
    elif msg_type == "last7days_total":
        text = await build_last7days_total(user_id)
    elif msg_type == "custom":
        text = body.get("text", "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Text required for custom message")
    else:
        raise HTTPException(status_code=400, detail=f"Unknown message type: {msg_type}")

    message_queue.append({"text": text, "user_id": user_id})
    return {"status": "queued", "text": text}


@router.get("/internal/messages")
async def pop_messages(request: Request):
    """Called by WhatsApp bot to get pending messages"""
    key = request.headers.get("X-Internal-Key")
    if key != os.getenv("INTERNAL_KEY", "homly-internal"):
        raise HTTPException(status_code=403, detail="Forbidden")
    msgs = message_queue.copy()
    message_queue.clear()
    return {"messages": msgs}


CATEGORY_EMOJI = {
    "groceries": "🛒", "household": "🏠", "personal care": "🧴",
    "food & beverage": "🍜", "transport": "🚌", "other": "📦",
}


async def build_week_total(user_id: str, year: int = None, week_number: int = None) -> str:
    today = date.today()
    if not year or not week_number:
        iso = today.isocalendar()
        week_number = iso.week
        year = iso.year

    receipts_res = supabase.table("receipts")\
        .select("*")\
        .eq("user_id", user_id)\
        .eq("year", year)\
        .eq("week_number", week_number)\
        .eq("deleted", False)\
        .order("date", desc=False)\
        .execute()

    receipts = receipts_res.data
    if not receipts:
        return f"No receipts recorded for week {week_number}, {year}."

    receipt_ids = [r["id"] for r in receipts]
    items_res = supabase.table("items")\
        .select("category, line_total")\
        .in_("receipt_id", receipt_ids)\
        .execute()

    category_totals: dict[str, float] = {}
    for item in items_res.data:
        cat = item["category"] or "other"
        category_totals[cat] = round(category_totals.get(cat, 0) + (item["line_total"] or 0), 2)

    total = sum(r["total"] or 0 for r in receipts)
    flagged = sum(1 for r in receipts if r.get("flagged"))

    receipt_lines = []
    for r in receipts:
        d = r["date"] or "Unknown"
        vendor = r["vendor"] or "Unknown vendor"
        amt = f"SGD {float(r['total']):.2f}" if r["total"] else "unclear"
        sender = f" ({r['sender_name']})" if r.get("sender_name") else ""
        flag = " ⚠️" if r.get("flagged") else " ✓"
        receipt_lines.append(f"{d}  {vendor}{sender}\n  {amt}{flag}")

    category_lines = "\n".join(
        f"{CATEGORY_EMOJI.get(cat, '•')} {cat.capitalize()}: SGD {amt:.2f}"
        for cat, amt in sorted(category_totals.items(), key=lambda x: -x[1])
    )

    flag_note = f"\n⚠️ {flagged} receipt{'s' if flagged > 1 else ''} need{'s' if flagged == 1 else ''} manual check" if flagged else ""

    return "\n".join([
        f"📋 *Week {week_number} Summary*",
        f"━━━━━━━━━━━━━━━━━━━━",
        "",
        "*Receipts:*",
        "\n".join(receipt_lines),
        "",
        "*By Category:*",
        category_lines or "No categorised items",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        f"💰 *Total to reimburse: SGD {total:.2f}*{flag_note}",
    ])


async def build_last7days_total(user_id: str) -> str:
    today = date.today()
    date_from = today - timedelta(days=6)

    receipts_res = supabase.table("receipts")\
        .select("*")\
        .eq("user_id", user_id)\
        .eq("deleted", False)\
        .gte("date", date_from.isoformat())\
        .lte("date", today.isoformat())\
        .order("date", desc=False)\
        .execute()

    receipts = receipts_res.data
    if not receipts:
        return f"No receipts recorded from {date_from} to {today}."

    receipt_ids = [r["id"] for r in receipts]
    items_res = supabase.table("items")\
        .select("category, line_total")\
        .in_("receipt_id", receipt_ids)\
        .execute()

    category_totals: dict[str, float] = {}
    for item in items_res.data:
        cat = item["category"] or "other"
        category_totals[cat] = round(category_totals.get(cat, 0) + (item["line_total"] or 0), 2)

    total = sum(r["total"] or 0 for r in receipts)
    flagged = sum(1 for r in receipts if r.get("flagged"))

    receipt_lines = []
    for r in receipts:
        d = r["date"] or "Unknown"
        vendor = r["vendor"] or "Unknown vendor"
        amt = f"SGD {float(r['total']):.2f}" if r["total"] else "unclear"
        sender = f" ({r['sender_name']})" if r.get("sender_name") else ""
        flag = " ⚠️" if r.get("flagged") else " ✓"
        receipt_lines.append(f"{d}  {vendor}{sender}\n  {amt}{flag}")

    category_lines = "\n".join(
        f"{CATEGORY_EMOJI.get(cat, '•')} {cat.capitalize()}: SGD {amt:.2f}"
        for cat, amt in sorted(category_totals.items(), key=lambda x: -x[1])
    )

    flag_note = f"\n⚠️ {flagged} receipt{'s' if flagged > 1 else ''} need{'s' if flagged == 1 else ''} manual check" if flagged else ""

    return "\n".join([
        f"📋 *Expense Summary*",
        f"{date_from} – {today}",
        f"━━━━━━━━━━━━━━━━━━━━",
        "",
        "*Receipts:*",
        "\n".join(receipt_lines),
        "",
        "*By Category:*",
        category_lines or "No categorised items",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        f"💰 *Total to reimburse: SGD {total:.2f}*{flag_note}",
    ])
