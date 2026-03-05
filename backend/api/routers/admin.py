import os
from collections import defaultdict
from fastapi import APIRouter, Request
from supabase import create_client
from dotenv import load_dotenv
from api.routers.households import require_super_admin

load_dotenv()

router = APIRouter()
supabase_client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


@router.get("/admin/price-intelligence")
def price_intelligence(request: Request):
    require_super_admin(request)

    result = supabase_client.table("price_history").select("*").execute()
    records = result.data or []

    empty_summary = {
        "total_items_tracked": 0,
        "total_price_records": 0,
        "total_households_contributing": 0,
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

    # ── Build lookup: canonical_name → meta ──────────────────────────────────
    item_meta: dict[str, dict] = {}
    for r in records:
        name = r.get("canonical_name")
        if name and name not in item_meta:
            item_meta[name] = {
                "brand": r.get("brand"),
                "variant": r.get("variant"),
                "category": r.get("category"),
            }

    # ── 1. Price comparison ──────────────────────────────────────────────────
    item_vendor_prices: dict[tuple, list] = defaultdict(list)
    for r in records:
        if r.get("unit_price") is None:
            continue
        name = r["canonical_name"]
        vendor = r.get("vendor") or ""
        item_vendor_prices[(name, vendor)].append(float(r["unit_price"]))

    item_total_count: dict[str, int] = defaultdict(int)
    for (name, _), prices in item_vendor_prices.items():
        item_total_count[name] += len(prices)

    price_comparison = []
    for (name, vendor), prices in item_vendor_prices.items():
        if item_total_count[name] < 3:
            continue
        meta = item_meta.get(name, {})
        price_comparison.append({
            "canonical_name": name,
            "brand": meta.get("brand"),
            "variant": meta.get("variant"),
            "category": meta.get("category"),
            "vendor": vendor,
            "avg_price": round(sum(prices) / len(prices), 2),
            "min_price": round(min(prices), 2),
            "max_price": round(max(prices), 2),
            "purchase_count": len(prices),
        })
    price_comparison.sort(key=lambda x: (x["canonical_name"], x["vendor"]))

    # ── 2. Cheapest store by category ────────────────────────────────────────
    # cat → item → vendor → [prices]
    cat_item_vendor: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for r in records:
        if r.get("unit_price") is None or not r.get("category") or not r.get("vendor"):
            continue
        cat_item_vendor[r["category"]][r["canonical_name"]][r["vendor"]].append(
            float(r["unit_price"])
        )

    cheapest_store_by_category = []
    for cat, item_data in cat_item_vendor.items():
        vendor_wins: dict[str, int] = defaultdict(int)
        cat_vendor_all_prices: dict[str, list] = defaultdict(list)

        for item_name, vendor_prices in item_data.items():
            for vendor, prices in vendor_prices.items():
                cat_vendor_all_prices[vendor].extend(prices)
            if len(vendor_prices) >= 2:
                v_avg = {v: sum(ps) / len(ps) for v, ps in vendor_prices.items()}
                cheapest_v = min(v_avg, key=lambda x: v_avg[x])
                vendor_wins[cheapest_v] += 1

        if not cat_vendor_all_prices:
            continue

        cat_vendor_avg = {
            v: sum(ps) / len(ps) for v, ps in cat_vendor_all_prices.items()
        }
        most_expensive_avg = max(cat_vendor_avg.values())
        cheapest_avg = min(cat_vendor_avg.values())

        winning_vendor = (
            max(vendor_wins, key=lambda x: vendor_wins[x])
            if vendor_wins
            else min(cat_vendor_avg, key=lambda x: cat_vendor_avg[x])
        )

        cheapest_store_by_category.append({
            "category": cat,
            "vendor": winning_vendor,
            "wins": vendor_wins.get(winning_vendor, 0),
            "avg_saving_vs_most_expensive": round(most_expensive_avg - cheapest_avg, 2),
        })

    # ── 3. Price trends ───────────────────────────────────────────────────────
    # canonical_name → vendor → month → [prices]
    name_vendor_month: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    name_total: dict[str, int] = defaultdict(int)
    for r in records:
        if r.get("unit_price") is None or not r.get("bought_at"):
            continue
        name = r["canonical_name"]
        vendor = r.get("vendor") or ""
        month = r["bought_at"][:7]  # YYYY-MM
        name_vendor_month[name][vendor][month].append(float(r["unit_price"]))
        name_total[name] += 1

    price_trends = []
    for name, vendor_data in name_vendor_month.items():
        if name_total[name] < 5:
            continue
        brand = item_meta.get(name, {}).get("brand")
        for vendor, month_data in vendor_data.items():
            for month, prices in sorted(month_data.items()):
                price_trends.append({
                    "canonical_name": name,
                    "brand": brand,
                    "vendor": vendor,
                    "month": month,
                    "avg_price": round(sum(prices) / len(prices), 2),
                    "purchase_count": len(prices),
                })

    # ── 4. Summary ────────────────────────────────────────────────────────────
    canonical_names = {r["canonical_name"] for r in records if r.get("canonical_name")}
    household_ids = {r["household_id"] for r in records if r.get("household_id")}

    name_count: dict[str, int] = defaultdict(int)
    cat_prices_all: dict[str, list] = defaultdict(list)
    for r in records:
        if r.get("canonical_name"):
            name_count[r["canonical_name"]] += 1
        if r.get("category") and r.get("unit_price") is not None:
            cat_prices_all[r["category"]].append(float(r["unit_price"]))

    most_tracked = (
        max(name_count, key=lambda x: name_count[x]) if name_count else None
    )
    most_expensive_cat = (
        max(cat_prices_all, key=lambda x: sum(cat_prices_all[x]) / len(cat_prices_all[x]))
        if cat_prices_all
        else None
    )

    return {
        "price_comparison": price_comparison,
        "cheapest_store_by_category": cheapest_store_by_category,
        "price_trends": price_trends,
        "summary": {
            "total_items_tracked": len(canonical_names),
            "total_price_records": len(records),
            "total_households_contributing": len(household_ids),
            "most_tracked_item": most_tracked,
            "most_expensive_category": most_expensive_cat,
        },
    }
