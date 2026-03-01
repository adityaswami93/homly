import os
import logging
import jwt
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

SKIP_AUTH_PATHS = [
    "/",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/internal/qr",
    "/internal/connected",
    "/internal/settings",
    "/internal/messages",
    "/setup/state",
    "/setup/group",
    "/setup/qr-stream",
    "/auth/accept-invite",
]


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in SKIP_AUTH_PATHS:
            return await call_next(request)

        if request.method == "OPTIONS":
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(status_code=401, content={"detail": "Missing token"})

        token = auth_header.split(" ", 1)[1]

        # Allow service role key (used by WhatsApp bot)
        service_key = os.getenv("SUPABASE_KEY", "")
        if token == service_key:
            user_id = os.getenv("HOMLY_USER_ID")
            household_id = None
            role = "admin"
            try:
                member = supabase.table("household_members")\
                    .select("household_id, role")\
                    .eq("user_id", user_id)\
                    .execute()
                household_id = member.data[0]["household_id"] if member.data else None
                role = member.data[0]["role"] if member.data else "admin"
            except Exception as e:
                logger.error(f"Failed to fetch household for service user {user_id}: {e}")
            request.state.user = {
                "sub": user_id,
                "household_id": household_id,
                "role": role,
                "is_super_admin": False,
            }
            return await call_next(request)

        # Verify JWT
        try:
            payload = jwt.decode(
                token,
                os.getenv("SUPABASE_JWT_SECRET"),
                algorithms=["HS256"],
                audience="authenticated",
            )
        except jwt.ExpiredSignatureError:
            return JSONResponse(status_code=401, content={"detail": "Token expired"})
        except Exception as e:
            logger.warning(f"JWT decode failed: {type(e).__name__}: {e}")
            return JSONResponse(status_code=401, content={"detail": "Invalid token"})

        user_id = payload.get("sub")
        user_meta = payload.get("user_metadata", {})
        is_super_admin = user_meta.get("is_super_admin", False)

        # Get household membership
        household_id = None
        role = None
        try:
            member = supabase.table("household_members")\
                .select("household_id, role")\
                .eq("user_id", user_id)\
                .execute()
            household_id = member.data[0]["household_id"] if member.data else None
            role = member.data[0]["role"] if member.data else None
        except Exception as e:
            logger.error(f"Failed to fetch household for user {user_id}: {e}")

        request.state.user = {
            "sub": user_id,
            "household_id": household_id,
            "role": role,
            "is_super_admin": is_super_admin,
        }

        return await call_next(request)
