from fastapi import APIRouter
from pydantic import BaseModel
from services.db import get_supabase

router = APIRouter()

_supabase = get_supabase()


# Landing-page hero variants the frontend may report (see frontend/app/page.tsx).
# Anything else is stored as NULL rather than trusted — this value comes straight
# from an unauthenticated request body and is only ever read back in aggregate.
_KNOWN_VARIANTS = {"manager", "system"}


class WaitlistRequest(BaseModel):
    email: str
    variant: str | None = None


@router.post("/waitlist")
async def join_waitlist(payload: WaitlistRequest):
    email = payload.email.lower().strip()
    if not email or "@" not in email:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Invalid email")

    variant = payload.variant if payload.variant in _KNOWN_VARIANTS else None

    result = _supabase.table("waitlist").insert({"email": email, "variant": variant}).execute()

    if result.data is None:
        error = getattr(result, "error", None)
        if error and getattr(error, "code", None) == "23505":
            return {"status": "already_registered"}
        return {"status": "already_registered"}

    return {"status": "ok"}
