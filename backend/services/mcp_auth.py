"""
Shared MCP API key generation/verification, used by api/routers/mcp_keys.py
(issuing keys from the portal) and api/routers/mcp_data.py (verifying them
on every /mcp/data/* request) so the two never disagree on the key format
or hashing scheme.

Keys are opaque bearer tokens scoped to exactly one household — unlike the
WhatsApp bot's shared INTERNAL_KEY, a leaked MCP key only exposes the one
household it was issued for, and can be revoked independently of the others.
Only a SHA-256 hash is ever stored; the plaintext is shown once, at creation.

Keys live in the generic `api_keys` table (migrations/029_api_keys.sql),
distinguished by `scope` so future integrations (a public API, Zapier, etc.)
can reuse the same table/UI pattern instead of growing their own.
"""
import hashlib
import secrets

KEY_PREFIX = "homly_mcp_"
SCOPE = "mcp"


def generate_key() -> tuple[str, str, str]:
    """Returns (plaintext_key, key_hash, key_prefix_for_display)."""
    plaintext = f"{KEY_PREFIX}{secrets.token_urlsafe(32)}"
    return plaintext, hash_key(plaintext), plaintext[:len(KEY_PREFIX) + 6]


def hash_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode()).hexdigest()
