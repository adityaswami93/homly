import os
from fastapi import APIRouter, Request, HTTPException
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


def require_super_admin(request: Request):
    if not request.state.user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super admin access required")


def require_admin(request: Request):
    if request.state.user.get("role") != "admin" and not request.state.user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")


# ── Super admin endpoints ────────────────────────────────────

@router.get("/admin/households")
def list_households(request: Request):
    require_super_admin(request)
    households = supabase.table("households").select("*").order("created_at", desc=True).execute()
    result = []
    for h in households.data:
        members = supabase.table("household_members")\
            .select("user_id, role")\
            .eq("household_id", h["id"])\
            .execute()
        receipts = supabase.table("receipts")\
            .select("id", count="exact")\
            .eq("household_id", h["id"])\
            .execute()
        result.append({
            **h,
            "member_count":  len(members.data),
            "receipt_count": receipts.count or 0,
            "members":       members.data,
        })
    return result


@router.patch("/admin/households/{household_id}")
def update_household(household_id: str, request: Request, body: dict):
    require_super_admin(request)
    allowed = {"name", "plan", "active"}
    update = {k: v for k, v in body.items() if k in allowed}
    supabase.table("households").update(update).eq("id", household_id).execute()
    return {"status": "ok"}


@router.post("/admin/invite")
def invite_user(request: Request, body: dict):
    require_super_admin(request)
    email        = body.get("email")
    household_id = body.get("household_id")  # None = user creates own
    role         = body.get("role", "admin")

    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    # Create invite record
    invite = supabase.table("invites").insert({
        "email":        email,
        "household_id": household_id,
        "role":         role,
        "invited_by":   request.state.user["sub"],
    }).execute()

    token = invite.data[0]["token"]

    # Send invite email via Supabase Auth
    try:
        supabase.auth.admin.invite_user_by_email(
            email,
            options={"data": {"invite_token": token, "household_id": household_id, "role": role}}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send invite: {str(e)}")

    return {"status": "invited", "email": email, "token": token}


@router.get("/admin/invites")
def list_invites(request: Request):
    require_super_admin(request)
    invites = supabase.table("invites")\
        .select("*")\
        .order("created_at", desc=True)\
        .execute()
    return invites.data


@router.delete("/admin/invites/{invite_id}")
def delete_invite(invite_id: str, request: Request):
    require_super_admin(request)
    supabase.table("invites").delete().eq("id", invite_id).execute()
    return {"status": "ok"}


# ── Household endpoints (for logged-in users) ────────────────

@router.get("/household")
def get_my_household(request: Request):
    household_id = request.state.user.get("household_id")
    if not household_id:
        return {"household": None}
    household = supabase.table("households")\
        .select("*")\
        .eq("id", household_id)\
        .execute()
    members = supabase.table("household_members")\
        .select("user_id, role, joined_at")\
        .eq("household_id", household_id)\
        .execute()
    return {**household.data[0], "members": members.data}


@router.post("/household")
def create_household(request: Request, body: dict):
    user_id = request.state.user["sub"]
    existing = supabase.table("household_members")\
        .select("household_id")\
        .eq("user_id", user_id)\
        .execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="User already belongs to a household")
    name = body.get("name", "Home")
    household = supabase.table("households").insert({"name": name}).execute()
    household_id = household.data[0]["id"]
    supabase.table("household_members").insert({
        "household_id": household_id,
        "user_id":      user_id,
        "role":         "admin",
    }).execute()
    return household.data[0]


@router.post("/household/members")
def add_member(request: Request, body: dict):
    require_admin(request)
    household_id = request.state.user["household_id"]
    email = body.get("email")
    role  = body.get("role", "member")
    if not email:
        raise HTTPException(status_code=400, detail="Email required")
    # Look up user by email
    users = supabase.auth.admin.list_users()
    target = next((u for u in users if u.email == email), None)
    if not target:
        raise HTTPException(status_code=404, detail="User not found — they must sign up first")
    supabase.table("household_members").insert({
        "household_id": household_id,
        "user_id":      target.id,
        "role":         role,
        "invited_by":   request.state.user["sub"],
    }).execute()
    return {"status": "ok"}


@router.patch("/household/members/{user_id}")
def update_member(user_id: str, request: Request, body: dict):
    require_admin(request)
    household_id = request.state.user["household_id"]
    allowed = {"role"}
    update = {k: v for k, v in body.items() if k in allowed}
    supabase.table("household_members")\
        .update(update)\
        .eq("household_id", household_id)\
        .eq("user_id", user_id)\
        .execute()
    return {"status": "ok"}


@router.delete("/household/members/{user_id}")
def remove_member(user_id: str, request: Request):
    require_admin(request)
    household_id = request.state.user["household_id"]
    supabase.table("household_members")\
        .delete()\
        .eq("household_id", household_id)\
        .eq("user_id", user_id)\
        .execute()
    return {"status": "ok"}


# ── Accept invite (called after signup) ─────────────────────

@router.post("/auth/accept-invite")
def accept_invite(body: dict):
    token   = body.get("token")
    user_id = body.get("user_id")
    if not token or not user_id:
        raise HTTPException(status_code=400, detail="token and user_id required")

    invite = supabase.table("invites")\
        .select("*")\
        .eq("token", token)\
        .eq("accepted", False)\
        .execute()

    if not invite.data:
        raise HTTPException(status_code=404, detail="Invalid or expired invite")

    inv = invite.data[0]

    if inv.get("household_id"):
        # Add to existing household
        supabase.table("household_members").insert({
            "household_id": inv["household_id"],
            "user_id":      user_id,
            "role":         inv["role"],
            "invited_by":   inv["invited_by"],
        }).execute()
        household_id = inv["household_id"]
    else:
        # Create new household
        household = supabase.table("households").insert({"name": "Home"}).execute()
        household_id = household.data[0]["id"]
        supabase.table("household_members").insert({
            "household_id": household_id,
            "user_id":      user_id,
            "role":         "admin",
            "invited_by":   inv["invited_by"],
        }).execute()

    # Mark invite as accepted
    supabase.table("invites").update({"accepted": True}).eq("id", inv["id"]).execute()

    return {"status": "ok", "household_id": household_id}
