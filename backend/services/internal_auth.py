"""The one place the `X-Internal-Key` check lives.

This used to be copy-pasted into six routers (internal.py, messages.py,
commands.py, reminders.py, pantry.py, webhook.py), each spelling it:

    if request.headers.get("X-Internal-Key") != os.getenv("INTERNAL_KEY", "homly-internal"):

Two problems with that, beyond the duplication CLAUDE.md's "Backend stays DRY"
rule already rules out:

1. **The default was a live fallback, not a dev convenience.** `backend/.env.example`
   states INTERNAL_KEY is required and that internal endpoints reject everything
   if it is unset — but the code did the opposite: with INTERNAL_KEY missing in
   production, every `/internal/*` endpoint was protected by a string published
   in this repository. `/internal/graph-invoke` accepts an arbitrary
   `household_id`, so that is a cross-household read/write, not just a nuisance.
   There is no default here. An unset key fails every internal request closed.

2. **`!=` on secrets is not constant-time.** `hmac.compare_digest` is.

Read the env var per call rather than at import so tests (and anything that
loads .env after this module) see the value they set.
"""
import hmac
import logging
import os

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)

_warned = False


def internal_key() -> str | None:
    """The configured shared secret, or None if it isn't set."""
    return (os.getenv("INTERNAL_KEY") or "").strip() or None


def require_internal_key(request: Request) -> None:
    """Raise unless the caller presented the right `X-Internal-Key`.

    Callers are first-party server-to-server only — the WhatsApp bot today.
    Anything user-facing belongs behind the JWT middleware or a per-household
    MCP key instead; this secret is shared across every household and grants
    access to all of them.
    """
    global _warned
    expected = internal_key()
    if not expected:
        if not _warned:
            logger.error(
                "INTERNAL_KEY is not set — refusing all /internal/* requests. "
                "Set it in the backend environment and in the WhatsApp bot's env."
            )
            _warned = True
        raise HTTPException(status_code=503, detail="Internal endpoints are not configured")

    presented = request.headers.get("X-Internal-Key") or ""
    if not hmac.compare_digest(presented, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


def has_internal_key(request: Request) -> bool:
    """Non-raising variant, for callers that accept more than one credential.

    `/webhook/whatsapp` takes either this key (the Baileys bot) or a Green API
    instance id, so it needs to test rather than enforce. Same constant-time
    compare and same refusal to fall back to a default.
    """
    expected = internal_key()
    if not expected:
        return False
    return hmac.compare_digest(request.headers.get("X-Internal-Key") or "", expected)
