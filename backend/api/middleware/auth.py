import os
import logging
import jwt
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from services.db import get_supabase
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

supabase = get_supabase()

_jwks_client = jwt.PyJWKClient(
    f"{os.getenv('SUPABASE_URL')}/auth/v1/.well-known/jwks.json",
    cache_keys=True,
)

SKIP_AUTH_PATHS = [
    "/",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/auth/accept-invite",
    "/webhook/whatsapp",
    "/internal/qr",
    "/internal/connected",
    "/internal/qr-status",
    "/internal/messages",
    "/setup/reset-qr",
    "/internal/shopping-list",
    "/internal/pantry",
    "/internal/graph-invoke",
    "/internal/commands",
    "/internal/reminders/due",
    "/waitlist",
]


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # /mcp/data/* and /mcp/server/* cover dynamic path segments (receipt
        # ids, weeks, the MCP key itself), so they're matched by prefix rather
        # than added one-by-one to SKIP_AUTH_PATHS. Both authenticate
        # themselves with their own per-household bearer-key scheme, not a
        # Supabase JWT — /mcp/data/* via an Authorization header (see
        # api/routers/mcp_data.py's `_authenticate`), /mcp/server/{key} via
        # the key embedded in its own URL path (see mcp_server/remote.py) for
        # Claude's remote-connector UI, which has no field for custom headers.
        # /mcp/keys (api/routers/mcp_keys.py) is NOT exempted — it's a normal
        # JWT-authenticated endpoint for managing those bearer keys.
        # MCP clients probe /.well-known/oauth-authorization-server and
        # /.well-known/oauth-protected-resource (optionally with a
        # resource-specific suffix, per RFC 9728) to decide whether a remote
        # MCP server needs OAuth before ever calling it. This backend defines
        # no routes there, so without this bypass they'd fall through to the
        # blanket 401 below instead of a clean 404 — which a client reads as
        # "this server requires sign-in" and attempts (and fails) OAuth
        # client registration against, instead of "no OAuth here, proceed
        # without auth."
        if (
            request.url.path in SKIP_AUTH_PATHS
            or request.url.path.startswith("/mcp/data/")
            or request.url.path.startswith("/mcp/server/")
            or request.url.path.startswith("/.well-known/oauth-")
        ):
            return await call_next(request)

        if request.method == "OPTIONS":
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(status_code=401, content={"detail": "Missing token"})

        token = auth_header.split(" ", 1)[1]

        # Allow service role key (used by WhatsApp bot)
        # household_id is NOT resolved here — the endpoint reads it from the request body/params
        service_key = os.getenv("SUPABASE_KEY", "")
        if token == service_key:
            request.state.user = {
                "sub": None,
                "household_id": None,
                "role": "service",
                "is_service_key": True,
                "is_super_admin": False,
            }
            return await call_next(request)

        # Verify JWT via JWKS (handles ES256 and HS256 automatically)
        try:
            signing_key = _jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "HS256"],
                audience="authenticated",
                leeway=30,  # tolerate up to 30s clock skew between Supabase and this server
            )
        except jwt.ExpiredSignatureError:
            return JSONResponse(status_code=401, content={"detail": "Token expired"})
        except Exception as e:
            logger.warning(f"JWT decode failed: {type(e).__name__}: {e}")
            return JSONResponse(status_code=401, content={"detail": "Invalid token"})

        user_id = payload.get("sub")
        user_meta = payload.get("user_metadata", {})
        is_super_admin = user_meta.get("is_super_admin", False)

        # Get all household memberships for this user (a user may belong to
        # several households — e.g. their own household plus their parents')
        household_id = None
        role = None
        try:
            memberships = supabase.table("household_members")\
                .select("household_id, role, joined_at")\
                .eq("user_id", user_id)\
                .order("joined_at")\
                .execute()
            rows = memberships.data or []

            # A stale/invalid X-Household-Id (leftover in localStorage from a
            # previous user, or a household this user was removed from) must
            # not hard-block the request — that would strand the user on
            # discovery/onboarding calls like GET /households and
            # POST /household. Silently fall back to their first membership
            # instead; this never grants access to a household they're not
            # actually in, since we only ever honor a header that matches one
            # of their own membership rows.
            requested_household_id = request.headers.get("X-Household-Id")
            match = None
            if requested_household_id:
                match = next((r for r in rows if r["household_id"] == requested_household_id), None)

            active = match or (rows[0] if rows else None)
            if active:
                household_id = active["household_id"]
                role = active["role"]
        except Exception as e:
            # Don't fall through as "this user has no household": every
            # downstream endpoint would then either 403 or hand back an empty
            # dashboard, and GET /household would answer {"household": null} —
            # which the frontend reads as "not onboarded yet" and bounces a
            # fully set-up member to /onboarding. A lookup that *failed* is not
            # a lookup that came back empty; say so and let the caller retry.
            logger.error(f"Failed to fetch household for user {user_id}: {e}")
            return JSONResponse(
                status_code=503,
                content={"detail": "Could not load your household right now — please try again"},
            )

        request.state.user = {
            "sub": user_id,
            "household_id": household_id,
            "role": role,
            "is_super_admin": is_super_admin,
        }

        return await call_next(request)
