import os
from datetime import date, timedelta
from fastapi import APIRouter, Request, HTTPException
from supabase import create_client
from dotenv import load_dotenv

from services.reimbursement import compute_reimbursement_totals
from services.internal_auth import require_internal_key

load_dotenv()

router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

CATEGORY_EMOJI = {
    "groceries": "🛒", "household": "🏠", "personal care": "🧴",
    "food & beverage": "🍜", "transport": "🚌", "other": "📦",
}


@router.post("/messages/send")
async def send_message(request: Request, body: dict):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    msg_type = body.get("type")

    if msg_type == "week_total":
        text = await build_week_total(household_id, body.get("year"), body.get("week_number"))
    elif msg_type == "daterange_total":
        start = body.get("start")
        end = body.get("end")
        if not start or not end:
            raise HTTPException(status_code=400, detail="start and end required")
        text = await build_daterange_total(household_id, start, end)
    elif msg_type == "last7days_total":
        text = await build_last7days_total(household_id)
    elif msg_type == "custom":
        text = body.get("text", "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Text required for custom message")
    else:
        raise HTTPException(status_code=400, detail=f"Unknown message type: {msg_type}")

    group_jid = None
    try:
        s = supabase.table("settings").select("group_jid").eq("household_id", household_id).execute()
        group_jid = s.data[0]["group_jid"] if s.data else None
    except Exception:
        pass

    if not group_jid:
        raise HTTPException(status_code=400, detail="No WhatsApp group configured for this household")

    from services.whatsapp_client import send_text
    await send_text(group_jid, text, household_id)
    return {"status": "queued", "text": text}


@router.get("/internal/messages")
def pop_messages(request: Request):
    """Bot polls this to get pending outgoing messages."""
    require_internal_key(request)
    from services.whatsapp_client import pop_outgoing
    return {"messages": pop_outgoing()}


async def build_week_total(household_id: str, year: int = None, week_number: int = None) -> str:
    today = date.today()
    if not year or not week_number:
        iso = today.isocalendar()
        week_number = iso.week
        year = iso.year

    receipts_res = (
        supabase.table("receipts")
        .select("*")
        .eq("household_id", household_id)
        .eq("year", year)
        .eq("week_number", week_number)
        .eq("deleted", False)
        .order("date", desc=False)
        .execute()
    )
    receipts = receipts_res.data
    if not receipts:
        return f"No receipts recorded for week {week_number}, {year}."

    receipt_ids = [r["id"] for r in receipts]
    items_res = supabase.table("items").select("category, line_total").in_("receipt_id", receipt_ids).execute()

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
    flag_note = (
        f"\n⚠️ {flagged} receipt{'s' if flagged > 1 else ''} need{'s' if flagged == 1 else ''} manual check"
        if flagged else ""
    )

    return "\n".join([
        f"📋 *Week {week_number} Summary*",
        "━━━━━━━━━━━━━━━━━━━━",
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


async def build_daterange_total(household_id: str, start: str, end: str) -> str:
    """Builds the same summary shown on the dashboard for a given [start, end]
    custom-week range — mirrors GET /receipts/daterange rather than the ISO
    week grid, so the message matches whatever week the button was pressed on."""
    receipts_res = (
        supabase.table("receipts")
        .select("*")
        .eq("household_id", household_id)
        .eq("deleted", False)
        .gte("date", start)
        .lte("date", end)
        .order("date", desc=False)
        .execute()
    )
    receipts = receipts_res.data
    if not receipts:
        return f"No receipts recorded from {start} to {end}."

    receipt_ids = [r["id"] for r in receipts]
    items_res = supabase.table("items").select("category, line_total").in_("receipt_id", receipt_ids).execute()

    category_totals: dict[str, float] = {}
    for item in items_res.data:
        cat = item["category"] or "other"
        category_totals[cat] = round(category_totals.get(cat, 0) + (item["line_total"] or 0), 2)

    outstanding_reimbursable_total = compute_reimbursement_totals(receipts)["outstanding_reimbursable_total"]
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
    flag_note = (
        f"\n⚠️ {flagged} receipt{'s' if flagged > 1 else ''} need{'s' if flagged == 1 else ''} manual check"
        if flagged else ""
    )

    return "\n".join([
        "📋 *Week Summary*",
        f"{start} – {end}",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "*Receipts:*",
        "\n".join(receipt_lines),
        "",
        "*By Category:*",
        category_lines or "No categorised items",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        f"💰 *Total to reimburse: SGD {outstanding_reimbursable_total:.2f}*{flag_note}",
    ])


async def build_last7days_total(household_id: str) -> str:
    today = date.today()
    date_from = today - timedelta(days=6)

    receipts_res = (
        supabase.table("receipts")
        .select("*")
        .eq("household_id", household_id)
        .eq("deleted", False)
        .gte("date", date_from.isoformat())
        .lte("date", today.isoformat())
        .order("date", desc=False)
        .execute()
    )
    receipts = receipts_res.data
    if not receipts:
        return f"No receipts recorded from {date_from} to {today}."

    receipt_ids = [r["id"] for r in receipts]
    items_res = supabase.table("items").select("category, line_total").in_("receipt_id", receipt_ids).execute()

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
    flag_note = (
        f"\n⚠️ {flagged} receipt{'s' if flagged > 1 else ''} need{'s' if flagged == 1 else ''} manual check"
        if flagged else ""
    )

    return "\n".join([
        "📋 *Expense Summary*",
        f"{date_from} – {today}",
        "━━━━━━━━━━━━━━━━━━━━",
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
