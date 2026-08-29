import os
from fastapi import APIRouter, Request, HTTPException
from supabase import create_client
from dotenv import load_dotenv

from services.reimbursement import mark_receipts_reimbursed

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
    """Pay off every currently-unpaid reimbursable receipt in the given ISO
    week. Amounts are always derived from the receipts themselves (via
    services/reimbursement.py's mark_receipts_reimbursed) rather than typed
    in by the caller, so a payment can never drift from what receipts it
    actually covers."""
    household_id = request.state.user.get("household_id")
    user_id      = request.state.user["sub"]
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    year        = body.get("year")
    week_number = body.get("week_number")
    if year is None or week_number is None:
        raise HTTPException(status_code=400, detail="year and week_number required")

    receipts_res = supabase.table("receipts")\
        .select("id, date, total, reimbursable, reimbursement_id")\
        .eq("household_id", household_id)\
        .eq("year", year)\
        .eq("week_number", week_number)\
        .eq("deleted", False)\
        .execute()

    result = mark_receipts_reimbursed(
        supabase, household_id, receipts_res.data,
        note=body.get("note") or f"Week {week_number} reimbursement",
        created_by=user_id,
    )
    if not result:
        raise HTTPException(status_code=400, detail="Nothing outstanding for this week")
    return result["reimbursement"]


@router.get("/reimbursements/week/{year}/{week_number}")
def get_week_reimbursements(year: int, week_number: int, request: Request):
    """Payment history for one ISO week, found via the receipts that week's
    reimbursable receipts actually link to (receipts.reimbursement_id) —
    not by matching a (year, week_number) pair on the reimbursements row
    itself, since one payment can now cover a date range spanning several
    ISO weeks."""
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")

    receipts_res = supabase.table("receipts")\
        .select("reimbursement_id")\
        .eq("household_id", household_id)\
        .eq("year", year)\
        .eq("week_number", week_number)\
        .eq("deleted", False)\
        .not_.is_("reimbursement_id", "null")\
        .execute()
    reimbursement_ids = sorted({r["reimbursement_id"] for r in receipts_res.data})

    if not reimbursement_ids:
        return {"reimbursements": [], "total_paid": 0}

    res = supabase.table("reimbursements")\
        .select("*")\
        .eq("household_id", household_id)\
        .in_("id", reimbursement_ids)\
        .order("paid_at", desc=True)\
        .execute()
    total_paid = sum(float(r["amount"] or 0) for r in res.data)
    return {"reimbursements": res.data, "total_paid": round(total_paid, 2)}


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
