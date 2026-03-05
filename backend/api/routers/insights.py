import os
from fastapi import APIRouter, Request, HTTPException
from supabase import create_client
from datetime import date, timedelta
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv()

router    = APIRouter()
supabase  = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


# ── Price history ────────────────────────────────────────────

@router.get("/insights/price-history/{canonical_name}")
def get_price_history(canonical_name: str, request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    res = supabase.table("price_history")\
        .select("*")\
        .eq("household_id",   household_id)\
        .eq("canonical_name", canonical_name)\
        .order("bought_at",   desc=False)\
        .execute()

    data = res.data
    if not data:
        return {"canonical_name": canonical_name, "history": [], "insights": None}

    prices      = [r["unit_price"] for r in data if r["unit_price"]]
    avg_price   = round(sum(prices) / len(prices), 2) if prices else None
    min_price   = min(prices) if prices else None
    max_price   = max(prices) if prices else None
    last_price  = data[-1]["unit_price"] if data else None
    last_vendor = data[-1]["vendor"]     if data else None

    # Best vendor (lowest avg price)
    vendor_prices: dict[str, list] = defaultdict(list)
    for r in data:
        if r["vendor"] and r["unit_price"]:
            vendor_prices[r["vendor"]].append(r["unit_price"])
    best_vendor = None
    best_avg    = None
    for vendor, vprices in vendor_prices.items():
        avg = sum(vprices) / len(vprices)
        if best_avg is None or avg < best_avg:
            best_avg    = round(avg, 2)
            best_vendor = vendor

    # Price trend (last 4 purchases)
    recent    = [r["unit_price"] for r in data[-4:] if r["unit_price"]]
    trending  = None
    if len(recent) >= 2:
        if recent[-1] > recent[0]:
            trending = "up"
        elif recent[-1] < recent[0]:
            trending = "down"
        else:
            trending = "stable"

    return {
        "canonical_name": canonical_name,
        "history":        data,
        "insights": {
            "avg_price":   avg_price,
            "min_price":   min_price,
            "max_price":   max_price,
            "last_price":  last_price,
            "last_vendor": last_vendor,
            "best_vendor": best_vendor,
            "best_price":  best_avg,
            "trending":    trending,
            "buy_count":   len(data),
        },
    }


@router.get("/insights/price-alerts")
def get_price_alerts(request: Request):
    """Items bought recently at above-average price."""
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    # Get last 30 days purchases
    cutoff = (date.today() - timedelta(days=30)).isoformat()
    recent = supabase.table("price_history")\
        .select("*")\
        .eq("household_id", household_id)\
        .gte("bought_at",   cutoff)\
        .execute()

    # Get all history for comparison
    all_history = supabase.table("price_history")\
        .select("canonical_name, unit_price")\
        .eq("household_id", household_id)\
        .execute()

    # Build avg price map
    avg_map: dict[str, list] = defaultdict(list)
    for r in all_history.data:
        if r["unit_price"]:
            avg_map[r["canonical_name"]].append(r["unit_price"])

    alerts = []
    seen   = set()
    for r in recent.data:
        name  = r["canonical_name"]
        price = r["unit_price"]
        if not price or name in seen:
            continue
        prices = avg_map.get(name, [])
        if len(prices) < 3:
            continue  # not enough history
        avg = sum(prices) / len(prices)
        if price > avg * 1.15:  # 15% above average
            seen.add(name)
            alerts.append({
                "canonical_name": name,
                "brand":          r.get("brand"),
                "variant":        r.get("variant"),
                "paid_price":     price,
                "avg_price":      round(avg, 2),
                "pct_above":      round((price - avg) / avg * 100, 1),
                "vendor":         r["vendor"],
                "bought_at":      r["bought_at"],
            })

    return sorted(alerts, key=lambda x: x["pct_above"], reverse=True)


# ── Shopping list ─────────────────────────────────────────────

@router.get("/insights/shopping-list")
def get_shopping_list(request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    manual = supabase.table("shopping_list")\
        .select("*")\
        .eq("household_id", household_id)\
        .eq("checked",      False)\
        .order("created_at", desc=False)\
        .execute()

    suggestions = generate_suggestions(household_id)

    return {
        "items":       manual.data,
        "suggestions": suggestions,
    }


def generate_suggestions(household_id: str) -> list[dict]:
    """Suggest items based on purchase frequency."""
    cutoff = (date.today() - timedelta(days=90)).isoformat()
    history = supabase.table("price_history")\
        .select("canonical_name, brand, variant, category, bought_at")\
        .eq("household_id", household_id)\
        .gte("bought_at",   cutoff)\
        .order("bought_at", desc=False)\
        .execute()

    if not history.data:
        return []

    item_dates: dict[str, list] = defaultdict(list)
    item_meta:  dict[str, dict] = {}
    for r in history.data:
        name = r["canonical_name"]
        item_dates[name].append(r["bought_at"])
        item_meta[name] = {
            "canonical_name": name,
            "brand":          r.get("brand"),
            "variant":        r.get("variant"),
            "category":       r.get("category"),
        }

    today     = date.today()
    suggestions = []

    for name, dates in item_dates.items():
        if len(dates) < 2:
            continue

        sorted_dates = sorted(dates)
        intervals    = []
        for i in range(1, len(sorted_dates)):
            d1 = date.fromisoformat(sorted_dates[i-1])
            d2 = date.fromisoformat(sorted_dates[i])
            intervals.append((d2 - d1).days)

        avg_interval  = sum(intervals) / len(intervals)
        last_bought   = date.fromisoformat(sorted_dates[-1])
        days_since    = (today - last_bought).days
        days_until    = round(avg_interval - days_since)

        if days_until <= 3:
            urgency = "overdue" if days_until < 0 else "due_soon"
            suggestions.append({
                **item_meta[name],
                "last_bought":    sorted_dates[-1],
                "avg_interval":   round(avg_interval),
                "days_since":     days_since,
                "days_until":     days_until,
                "urgency":        urgency,
                "buy_count":      len(dates),
            })

    return sorted(suggestions, key=lambda x: x["days_until"])[:10]


@router.post("/insights/shopping-list")
def add_to_shopping_list(request: Request, body: dict):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    canonical_name = body.get("canonical_name")
    if not canonical_name:
        raise HTTPException(status_code=400, detail="canonical_name required")

    supabase.table("shopping_list").upsert({
        "household_id":   household_id,
        "canonical_name": canonical_name,
        "brand":          body.get("brand"),
        "variant":        body.get("variant"),
        "category":       body.get("category"),
        "added_by":       body.get("added_by", "manual"),
        "checked":        False,
    }, on_conflict="household_id,canonical_name").execute()

    return {"status": "ok"}


@router.patch("/insights/shopping-list/{canonical_name}")
def update_shopping_list_item(canonical_name: str, request: Request, body: dict):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    supabase.table("shopping_list")\
        .update({"checked": body.get("checked", True)})\
        .eq("household_id",   household_id)\
        .eq("canonical_name", canonical_name)\
        .execute()
    return {"status": "ok"}


@router.delete("/insights/shopping-list/{canonical_name}")
def delete_shopping_list_item(canonical_name: str, request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    supabase.table("shopping_list")\
        .delete()\
        .eq("household_id",   household_id)\
        .eq("canonical_name", canonical_name)\
        .execute()
    return {"status": "ok"}


@router.get("/internal/shopping-list")
async def get_shopping_list_internal(request: Request):
    """Called by WhatsApp bot to get shopping list."""
    key = request.headers.get("X-Internal-Key")
    if key != os.getenv("INTERNAL_KEY", "homly-internal"):
        raise HTTPException(status_code=403, detail="Forbidden")
    user_id = os.getenv("HOMLY_USER_ID")
    member  = supabase.table("household_members")\
        .select("household_id")\
        .eq("user_id", user_id)\
        .execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="No household")
    household_id = member.data[0]["household_id"]

    manual      = supabase.table("shopping_list")\
        .select("*")\
        .eq("household_id", household_id)\
        .eq("checked",      False)\
        .execute()
    suggestions = generate_suggestions(household_id)
    return {"items": manual.data, "suggestions": suggestions}
