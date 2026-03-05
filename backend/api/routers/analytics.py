import os
from fastapi import APIRouter, Request, HTTPException, Query
from typing import Optional
from supabase import create_client
from datetime import date, timedelta

router = APIRouter()

_supabase = None

def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


@router.get("/analytics")
def get_analytics(
    request: Request,
    date_from: Optional[str] = Query(default=None),
    date_to:   Optional[str] = Query(default=None),
):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    today = date.today()
    if date_to:
        try:
            end = date.fromisoformat(date_to)
        except ValueError:
            raise HTTPException(400, "Invalid date_to")
    else:
        end = today

    if date_from:
        try:
            start = date.fromisoformat(date_from)
        except ValueError:
            raise HTTPException(400, "Invalid date_from")
    else:
        start = end - timedelta(days=89)  # 90 days inclusive

    receipts_res = _db().table("receipts") \
        .select("id, vendor, date, total, reimbursable, flagged, sender_name, week_number, year") \
        .eq("household_id", household_id) \
        .eq("deleted", False) \
        .gte("date", start.isoformat()) \
        .lte("date", end.isoformat()) \
        .order("date", desc=False) \
        .execute()

    receipts = receipts_res.data

    receipt_ids = [r["id"] for r in receipts]
    if receipt_ids:
        items_res = _db().table("items") \
            .select("receipt_id, category, line_total") \
            .in_("receipt_id", receipt_ids) \
            .execute()
        items = items_res.data
    else:
        items = []

    # --- Summary stats ---
    total = sum(r["total"] or 0 for r in receipts)
    flagged_count = sum(1 for r in receipts if r.get("flagged"))
    flagged_rate = round(flagged_count / len(receipts), 4) if receipts else 0.0

    # Weekly spending
    weekly: dict[str, dict] = {}
    for r in receipts:
        key = f"{r['year']}-W{r['week_number']:02d}"
        if key not in weekly:
            weekly[key] = {
                "label": f"W{r['week_number']} {r['year']}",
                "week": r["week_number"],
                "year": r["year"],
                "total": 0.0,
                "reimbursable_total": 0.0,
                "receipt_count": 0,
            }
        weekly[key]["total"] += r["total"] or 0
        weekly[key]["receipt_count"] += 1
        if r.get("reimbursable"):
            weekly[key]["reimbursable_total"] += r["total"] or 0

    weekly_spending = []
    for w in sorted(weekly.values(), key=lambda x: (x["year"], x["week"])):
        weekly_spending.append({
            **w,
            "total": round(w["total"], 2),
            "reimbursable_total": round(w["reimbursable_total"], 2),
        })

    num_weeks = len(weekly_spending)
    avg_weekly = round(total / num_weeks, 2) if num_weeks > 0 else 0.0

    # Week-on-week change: last week vs second-to-last week
    wow_pct = None
    if len(weekly_spending) >= 2:
        last   = weekly_spending[-1]["total"]
        before = weekly_spending[-2]["total"]
        if before > 0:
            wow_pct = round((last - before) / before * 100, 1)

    # Category totals from items
    category_totals: dict[str, float] = {}
    for item in items:
        cat = item["category"] or "other"
        category_totals[cat] = round(category_totals.get(cat, 0) + (item["line_total"] or 0), 2)

    # Receipt volume by week (reuse weekly dict)
    receipt_volume = [
        {"label": w["label"], "week": w["week"], "year": w["year"], "count": w["receipt_count"]}
        for w in weekly_spending
    ]

    # Top vendors
    vendor_map: dict[str, dict] = {}
    for r in receipts:
        v = r.get("vendor") or "Unknown"
        if v not in vendor_map:
            vendor_map[v] = {"vendor": v, "count": 0, "total": 0.0}
        vendor_map[v]["count"] += 1
        vendor_map[v]["total"] += r["total"] or 0
    top_vendors = sorted(
        [{"vendor": k, "count": v["count"], "total": round(v["total"], 2)} for k, v in vendor_map.items()],
        key=lambda x: x["total"],
        reverse=True,
    )[:10]

    # Biggest purchases
    biggest = sorted(
        [{"id": r["id"], "vendor": r["vendor"], "date": r["date"], "total": r["total"],
          "reimbursable": r.get("reimbursable", False), "flagged": r.get("flagged", False)}
         for r in receipts if r["total"]],
        key=lambda x: x["total"],
        reverse=True,
    )[:10]

    # Sender breakdown
    sender_map: dict[str, dict] = {}
    for r in receipts:
        name = r.get("sender_name") or "You"
        if name not in sender_map:
            sender_map[name] = {"sender_name": name, "total": 0.0, "reimbursable_total": 0.0, "receipt_count": 0}
        sender_map[name]["total"] += r["total"] or 0
        sender_map[name]["receipt_count"] += 1
        if r.get("reimbursable"):
            sender_map[name]["reimbursable_total"] += r["total"] or 0
    sender_breakdown = sorted(
        [{"sender_name": k, "total": round(v["total"], 2),
          "reimbursable_total": round(v["reimbursable_total"], 2),
          "receipt_count": v["receipt_count"]}
         for k, v in sender_map.items()],
        key=lambda x: x["total"],
        reverse=True,
    )

    return {
        "date_from":        start.isoformat(),
        "date_to":          end.isoformat(),
        "summary": {
            "total":        round(total, 2),
            "avg_weekly":   avg_weekly,
            "wow_pct":      wow_pct,
            "flagged_rate": flagged_rate,
            "receipt_count": len(receipts),
        },
        "weekly_spending":  weekly_spending,
        "category_totals":  category_totals,
        "receipt_volume":   receipt_volume,
        "top_vendors":      top_vendors,
        "biggest_purchases": biggest,
        "sender_breakdown": sender_breakdown,
    }
