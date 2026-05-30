import os
from fastapi import APIRouter
from pydantic import BaseModel, EmailStr
from supabase import create_client

router = APIRouter()

_supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


class WaitlistRequest(BaseModel):
    email: str


@router.post("/waitlist")
async def join_waitlist(payload: WaitlistRequest):
    email = payload.email.lower().strip()
    if not email or "@" not in email:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Invalid email")

    result = _supabase.table("waitlist").insert({"email": email}).execute()

    if result.data is None:
        error = getattr(result, "error", None)
        if error and getattr(error, "code", None) == "23505":
            return {"status": "already_registered"}
        return {"status": "already_registered"}

    return {"status": "ok"}
