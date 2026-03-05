import os
from fastapi import APIRouter, Request, HTTPException
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


@router.get("/reimbursements")
def list_reimbursements(request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    res = supabase.table("reimbursements")\
        .select("*")\
        .eq("household_id", household_id)\
        .order("paid_at", desc=True)\
        .execute()
    return res.data


@router.post("/reimbursements")
def mark_reimbursed(request: Request, body: dict):
    household_id = request.state.user.get("household_id")
    user_id      = request.state.user["sub"]
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    year        = body.get("year")
    week_number = body.get("week_number")
    amount      = body.get("amount")
    note        = body.get("note")

    if not all([year, week_number, amount]):
        raise HTTPException(status_code=400, detail="year, week_number and amount required")

    res = supabase.table("reimbursements").insert({
        "household_id": household_id,
        "year":         year,
        "week_number":  week_number,
        "amount":       amount,
        "note":         note,
        "created_by":   user_id,
    }).execute()
    return res.data[0]


@router.delete("/reimbursements/{reimbursement_id}")
def delete_reimbursement(reimbursement_id: str, request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    existing = supabase.table("reimbursements")\
        .select("household_id")\
        .eq("id", reimbursement_id)\
        .execute()
    if not existing.data or existing.data[0]["household_id"] != household_id:
        raise HTTPException(status_code=404, detail="Not found")
    supabase.table("reimbursements").delete().eq("id", reimbursement_id).execute()
    return {"status": "ok"}


@router.get("/reimbursements/week/{year}/{week_number}")
def get_week_reimbursements(year: int, week_number: int, request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    res = supabase.table("reimbursements")\
        .select("*")\
        .eq("household_id",  household_id)\
        .eq("year",          year)\
        .eq("week_number",   week_number)\
        .execute()
    total_paid = sum(r["amount"] for r in res.data)
    return {"reimbursements": res.data, "total_paid": round(total_paid, 2)}
