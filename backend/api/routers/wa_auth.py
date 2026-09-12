"""Baileys session storage for the WhatsApp bot, behind INTERNAL_KEY.

The bot persists its WhatsApp session (`whatsapp_auth`, migration 021) so it
survives Railway redeploys without a volume. It used to do that with a
Supabase service role client in-process — a non-expiring, RLS-bypassing,
every-table credential living in the one process that parses untrusted input
from the public internet. These four endpoints are the entire surface
backend/whatsapp/db-auth-state.js needs, so that key can leave the bot.

`whatsapp_auth` is keyed by `tenant_id`, not `household_id` — it stores one
bot process's WhatsApp credentials, which is a platform-level thing, not a
household's. That is why the household-scoping rule in CLAUDE.md doesn't apply
here and why these are internal-key-only with no household resolution.

The stored `value` is a Baileys session blob: signal keys and credentials.
Treat it as secret material — it is never returned to any user-facing route.
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from services.db import get_supabase
from services.internal_auth import require_internal_key

logger = logging.getLogger(__name__)
router = APIRouter()

TABLE = "whatsapp_auth"
# Supabase rejects very large payloads; the bot already batches at 50 and the
# cap is here too so a malformed client can't push an unbounded write.
MAX_ROWS_PER_WRITE = 200

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = get_supabase()
    return _supabase


class AuthRow(BaseModel):
    key: str
    value: str


class UpsertIn(BaseModel):
    tenant_id: str
    rows: List[AuthRow]


class DeleteIn(BaseModel):
    tenant_id: str
    keys: List[str]


class ClearIn(BaseModel):
    tenant_id: str
    # Baileys' keys.clear() drops signal keys but keeps `creds`; deleteSession()
    # drops everything including creds. One flag covers both callers.
    keep_creds: bool = False


@router.get("/internal/wa-auth")
def load_auth_state(request: Request, tenant_id: Optional[str] = None):
    """Every stored row for a tenant — the bot's boot-time cache fill."""
    require_internal_key(request)
    if not tenant_id:
        raise HTTPException(400, "tenant_id required")

    res = _db().table(TABLE).select("key, value").eq("tenant_id", tenant_id).execute()
    return {"rows": res.data or []}


@router.post("/internal/wa-auth/upsert")
def upsert_auth_state(body: UpsertIn, request: Request):
    require_internal_key(request)
    if not body.rows:
        return {"status": "ok", "count": 0}
    if len(body.rows) > MAX_ROWS_PER_WRITE:
        raise HTTPException(413, f"Too many rows (max {MAX_ROWS_PER_WRITE})")

    payload = [
        {"tenant_id": body.tenant_id, "key": r.key, "value": r.value}
        for r in body.rows
    ]
    _db().table(TABLE).upsert(payload, on_conflict="tenant_id,key").execute()
    return {"status": "ok", "count": len(payload)}


@router.post("/internal/wa-auth/delete")
def delete_auth_keys(body: DeleteIn, request: Request):
    require_internal_key(request)
    if not body.keys:
        return {"status": "ok", "count": 0}

    _db().table(TABLE).delete()\
        .eq("tenant_id", body.tenant_id)\
        .in_("key", body.keys)\
        .execute()
    return {"status": "ok", "count": len(body.keys)}


@router.post("/internal/wa-auth/clear")
def clear_auth_state(body: ClearIn, request: Request):
    require_internal_key(request)

    q = _db().table(TABLE).delete().eq("tenant_id", body.tenant_id)
    if body.keep_creds:
        q = q.neq("key", "creds")
    else:
        logger.warning("Clearing full WhatsApp session for tenant %s", body.tenant_id)
    q.execute()
    return {"status": "ok"}
