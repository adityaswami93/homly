from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from services.db import get_supabase
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()
supabase = get_supabase()

VALID_ACCOUNT_TYPES = {
    "bank_savings", "fixed_deposit", "retirement_fund",
    "stocks", "mutual_fund", "bonds", "property", "other",
}


class AccountIn(BaseModel):
    account_type: str
    scheme_name: Optional[str] = None
    institution: Optional[str] = None
    account_name: str
    current_balance: float = 0
    currency: Optional[str] = None
    interest_rate: Optional[float] = None
    maturity_date: Optional[str] = None
    notes: Optional[str] = None


def get_household_id(request: Request) -> str:
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    return household_id


def require_admin(request: Request) -> None:
    # Backend calls use the Supabase service role key, which bypasses RLS —
    # the "household admins can manage" policy on savings_accounts provides
    # no protection on its own, so mutations must be gated here too.
    if request.state.user.get("role") != "admin" and not request.state.user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")


def validate_account(data: dict) -> None:
    if data.get("account_type") and data["account_type"] not in VALID_ACCOUNT_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid account_type: {data['account_type']}")


def get_household_currency(household_id: str) -> str:
    res = supabase.table("households").select("default_currency").eq("id", household_id).execute()
    if res.data and res.data[0].get("default_currency"):
        return res.data[0]["default_currency"]
    return "SGD"


def record_balance(household_id: str, account_id: str, balance: float) -> None:
    supabase.table("savings_balance_history").insert({
        "household_id": household_id,
        "account_id": account_id,
        "balance": balance,
    }).execute()


@router.get("/savings")
def list_accounts(request: Request):
    """List all active savings/investment accounts for the user's household."""
    household_id = get_household_id(request)
    res = (
        supabase.table("savings_accounts")
        .select("*")
        .eq("household_id", household_id)
        .eq("is_active", True)
        .order("account_type")
        .order("account_name")
        .execute()
    )
    return res.data


@router.post("/savings", status_code=201)
def create_account(request: Request, body: AccountIn):
    """Create a new savings/investment account for the user's household."""
    household_id = get_household_id(request)
    require_admin(request)
    user_id = request.state.user.get("sub")

    data = body.model_dump(exclude_none=True)
    validate_account(data)

    data["household_id"] = household_id
    data["created_by"] = user_id
    data["is_active"] = True
    if not data.get("currency"):
        data["currency"] = get_household_currency(household_id)

    res = supabase.table("savings_accounts").insert(data).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create account")

    account = res.data[0]
    record_balance(household_id, account["id"], account["current_balance"])
    return account


@router.put("/savings/{account_id}")
def update_account(account_id: str, request: Request, body: AccountIn):
    """Update an existing savings/investment account (must belong to the user's household)."""
    household_id = get_household_id(request)
    require_admin(request)

    existing = (
        supabase.table("savings_accounts")
        .select("id, current_balance")
        .eq("id", account_id)
        .eq("household_id", household_id)
        .eq("is_active", True)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Account not found")

    data = body.model_dump(exclude_none=True)
    validate_account(data)
    data["updated_at"] = "now()"

    res = (
        supabase.table("savings_accounts")
        .update(data)
        .eq("id", account_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to update account")

    updated = res.data[0]
    if "current_balance" in data and data["current_balance"] != existing.data[0]["current_balance"]:
        record_balance(household_id, account_id, updated["current_balance"])
    return updated


@router.delete("/savings/{account_id}", status_code=204)
def deactivate_account(account_id: str, request: Request):
    """Soft-delete an account by marking is_active = false."""
    household_id = get_household_id(request)
    require_admin(request)

    existing = (
        supabase.table("savings_accounts")
        .select("id")
        .eq("id", account_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Account not found")

    supabase.table("savings_accounts").update({"is_active": False, "updated_at": "now()"}).eq(
        "id", account_id
    ).execute()


@router.get("/savings/networth")
def get_net_worth(request: Request):
    """Aggregate current balances by currency, and by account_type within each currency."""
    household_id = get_household_id(request)
    res = (
        supabase.table("savings_accounts")
        .select("account_type, current_balance, currency")
        .eq("household_id", household_id)
        .eq("is_active", True)
        .execute()
    )
    accounts = res.data or []

    # Balances are never summed across currencies — a household can hold
    # accounts in more than one currency (the default is per-household, but
    # it can be overridden per account), so totals are grouped by currency.
    totals_by_currency: dict[str, float] = {}
    by_type: dict[str, dict[str, float]] = {}
    for a in accounts:
        currency = a["currency"]
        balance = a["current_balance"] or 0
        totals_by_currency[currency] = totals_by_currency.get(currency, 0) + balance
        by_type.setdefault(currency, {})
        by_type[currency][a["account_type"]] = by_type[currency].get(a["account_type"], 0) + balance

    return {
        "totals_by_currency": {c: round(v, 2) for c, v in totals_by_currency.items()},
        "by_type": {c: {t: round(v, 2) for t, v in types.items()} for c, types in by_type.items()},
        "account_count": len(accounts),
    }


@router.get("/savings/history")
def get_net_worth_history(request: Request):
    """Net worth over time, grouped by currency — daily sum of all accounts'
    latest balance up to each recorded date, per currency."""
    household_id = get_household_id(request)

    accounts_res = (
        supabase.table("savings_accounts")
        .select("id, currency")
        .eq("household_id", household_id)
        .execute()
    )
    currency_by_account = {a["id"]: a["currency"] for a in (accounts_res.data or [])}

    res = (
        supabase.table("savings_balance_history")
        .select("account_id, balance, recorded_at")
        .eq("household_id", household_id)
        .order("recorded_at")
        .execute()
    )
    rows = res.data or []

    # Roll up to one point per day: for each day, carry forward the latest
    # known balance per account, then sum within each currency.
    latest_by_account: dict[str, float] = {}
    seen_days: dict[str, dict] = {}
    for row in rows:
        day = row["recorded_at"][:10]
        latest_by_account[row["account_id"]] = row["balance"]
        seen_days[day] = dict(latest_by_account)

    points = []
    for day, balances in seen_days.items():
        totals_by_currency: dict[str, float] = {}
        for account_id, balance in balances.items():
            currency = currency_by_account.get(account_id, "SGD")
            totals_by_currency[currency] = totals_by_currency.get(currency, 0) + balance
        points.append({
            "date": day,
            "totals_by_currency": {c: round(v, 2) for c, v in totals_by_currency.items()},
        })

    return {"points": points}
