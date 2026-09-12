import os
from fastapi import APIRouter, Request, HTTPException
from services.db import get_supabase
from datetime import date, timedelta
from collections import defaultdict
from dotenv import load_dotenv

from services.price_history import compute_price_insights

load_dotenv()

router    = APIRouter()
supabase  = get_supabase()


# ── Household price intelligence ─────────────────────────────

@router.get("/insights/price-intelligence")
def household_price_intelligence(request: Request):
    """Household-scoped price comparison, cheapest stores, and trends."""
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    result = supabase.table("price_history").select("*").eq("household_id", household_id).execute()
    records = result.data or []

    empty_summary = {
        "total_items_tracked": 0,
        "total_price_records": 0,
        "most_tracked_item": None,
        "most_expensive_category": None,
    }
    if not records:
        return {
            "price_comparison": [],
            "cheapest_store_by_category": [],
            "price_trends": [],
            "summary": empty_summary,
        }

    item_meta: dict[str, dict] = {}
    for r in records:
        name = r.get("canonical_name")
        if name and name not in item_meta:
            item_meta[name] = {"brand": r.get("brand"), "variant": r.get("variant"), "category": r.get("category")}

    # 1. Price comparison
    item_vendor_prices: dict[tuple, list] = defaultdict(list)
    for r in records:
        if r.get("unit_price") is None:
            continue
        item_vendor_prices[(r["canonical_name"], r.get("vendor") or "")].append(float(r["unit_price"]))

    item_total_count: dict[str, int] = defaultdict(int)
    for (name, _), prices in item_vendor_prices.items():
        item_total_count[name] += len(prices)

    price_comparison = []
    for (name, vendor), prices in item_vendor_prices.items():
        if item_total_count[name] < 2:
            continue
        meta = item_meta.get(name, {})
        price_comparison.append({
            "canonical_name": name,
            "brand":          meta.get("brand"),
            "variant":        meta.get("variant"),
            "vendor":         vendor,
            "avg_price":      round(sum(prices) / len(prices), 2),
            "min_price":      round(min(prices), 2),
            "max_price":      round(max(prices), 2),
            "purchase_count": len(prices),
        })
    price_comparison.sort(key=lambda x: (x["canonical_name"], x["vendor"]))

    # 2. Cheapest store by category
    cat_item_vendor: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for r in records:
        if r.get("unit_price") is None or not r.get("category") or not r.get("vendor"):
            continue
        cat_item_vendor[r["category"]][r["canonical_name"]][r["vendor"]].append(float(r["unit_price"]))

    cheapest_store_by_category = []
    for cat, item_data in cat_item_vendor.items():
        vendor_wins: dict[str, int] = defaultdict(int)
        cat_vendor_all_prices: dict[str, list] = defaultdict(list)
        for item_name, vendor_prices in item_data.items():
            for vendor, prices in vendor_prices.items():
                cat_vendor_all_prices[vendor].extend(prices)
            if len(vendor_prices) >= 2:
                v_avg = {v: sum(ps) / len(ps) for v, ps in vendor_prices.items()}
                vendor_wins[min(v_avg, key=lambda x: v_avg[x])] += 1
        if not cat_vendor_all_prices:
            continue
        cat_vendor_avg = {v: sum(ps) / len(ps) for v, ps in cat_vendor_all_prices.items()}
        most_expensive_avg = max(cat_vendor_avg.values())
        cheapest_avg = min(cat_vendor_avg.values())
        winning_vendor = (
            max(vendor_wins, key=lambda x: vendor_wins[x]) if vendor_wins
            else min(cat_vendor_avg, key=lambda x: cat_vendor_avg[x])
        )
        cheapest_store_by_category.append({
            "category": cat,
            "vendor":   winning_vendor,
            "wins":     vendor_wins.get(winning_vendor, 0),
            "avg_saving_vs_most_expensive": round(most_expensive_avg - cheapest_avg, 2),
        })

    # 3. Price trends
    name_vendor_month: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    name_total: dict[str, int] = defaultdict(int)
    for r in records:
        if r.get("unit_price") is None or not r.get("bought_at"):
            continue
        name = r["canonical_name"]
        month = r["bought_at"][:7]
        name_vendor_month[name][r.get("vendor") or ""][month].append(float(r["unit_price"]))
        name_total[name] += 1

    price_trends = []
    for name, vendor_data in name_vendor_month.items():
        if name_total[name] < 3:
            continue
        brand = item_meta.get(name, {}).get("brand")
        for vendor, month_data in vendor_data.items():
            for month, prices in sorted(month_data.items()):
                price_trends.append({
                    "canonical_name": name,
                    "brand":          brand,
                    "vendor":         vendor,
                    "month":          month,
                    "avg_price":      round(sum(prices) / len(prices), 2),
                    "purchase_count": len(prices),
                })

    # 4. Summary
    canonical_names = {r["canonical_name"] for r in records if r.get("canonical_name")}
    name_count: dict[str, int] = defaultdict(int)
    cat_prices_all: dict[str, list] = defaultdict(list)
    for r in records:
        if r.get("canonical_name"):
            name_count[r["canonical_name"]] += 1
        if r.get("category") and r.get("unit_price") is not None:
            cat_prices_all[r["category"]].append(float(r["unit_price"]))

    most_tracked = max(name_count, key=lambda x: name_count[x]) if name_count else None
    most_expensive_cat = (
        max(cat_prices_all, key=lambda x: sum(cat_prices_all[x]) / len(cat_prices_all[x]))
        if cat_prices_all else None
    )

    return {
        "price_comparison":          price_comparison,
        "cheapest_store_by_category": cheapest_store_by_category,
        "price_trends":              price_trends,
        "summary": {
            "total_items_tracked":  len(canonical_names),
            "total_price_records":  len(records),
            "most_tracked_item":    most_tracked,
            "most_expensive_category": most_expensive_cat,
        },
    }


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

    return {
        "canonical_name": canonical_name,
        "history":        data,
        "insights":       compute_price_insights(data),
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
