import os
import jwt
from jwt.exceptions import PyJWTError
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_KEY")
HOMLY_USER_ID = os.getenv("HOMLY_USER_ID")
jwks_client = jwt.PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")

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
]

class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in SKIP_AUTH_PATHS:
            return await call_next(request)

        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={"detail": "Not authenticated"}
            )

        token = auth_header.split(" ")[1]

        # Allow the service role key (used by the WhatsApp bot — no expiry)
        if SUPABASE_SERVICE_KEY and token == SUPABASE_SERVICE_KEY:
            request.state.user = {"sub": HOMLY_USER_ID, "role": "service_role"}
            return await call_next(request)

        try:
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256"],
                audience="authenticated"
            )
            request.state.user = payload
        except PyJWTError as e:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid token"}
            )

        return await call_next(request)