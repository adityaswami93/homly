from fastapi import APIRouter, Request, HTTPException, Query
from typing import Optional
from services.db import get_supabase
from datetime import date
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

_supabase = None

def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
    return _supabase


@router.get("/budgets")
def list_budgets(request: Request, month: Optional[str] = Query(default=None)):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    if month is None:
        month = date.today().strftime("%Y-%m")

    res = _db().table("budgets") \
        .select("*") \
        .eq("household_id", household_id) \
        .eq("month", month) \
        .execute()

    return {"month": month, "budgets": res.data}


@router.post("/budgets")
def set_budget(request: Request, body: dict):
    household_id = request.state.user.get("household_id")
    user_id = request.state.user.get("sub")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    month = body.get("month") or date.today().strftime("%Y-%m")
    category = body.get("category")  # None = overall
    amount = body.get("amount")

    if amount is None:
        raise HTTPException(status_code=400, detail="amount required")
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="amount must be a number")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be positive")

    res = _db().table("budgets").upsert({
        "household_id": household_id,
        "month":        month,
        "category":     category,
        "amount":       amount,
        "created_by":   user_id,
        "updated_at":   "NOW()",
    }, on_conflict="household_id,month,category").execute()

    return res.data[0]


@router.delete("/budgets/{budget_id}")
def delete_budget(budget_id: str, request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    existing = _db().table("budgets") \
        .select("household_id") \
        .eq("id", budget_id) \
        .execute()
    if not existing.data or existing.data[0]["household_id"] != household_id:
        raise HTTPException(status_code=404, detail="Budget not found")

    _db().table("budgets").delete().eq("id", budget_id).execute()
    return {"status": "ok"}
