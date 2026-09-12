"""services/internal_auth.py is the only gate in front of /internal/*.

Those endpoints are exempt from the JWT middleware and several of them take a
household_id (or a group_jid that resolves to one) straight from the request
body, so a weakness here is a cross-household read/write, not a nuisance.

The regression these tests exist for: the check used to be copy-pasted into six
routers as

    os.getenv("INTERNAL_KEY", "homly-internal")

which meant an unset INTERNAL_KEY in production left every internal endpoint
guarded by a string published in this repository.
"""

import pytest
from fastapi import HTTPException

from services.internal_auth import has_internal_key, internal_key, require_internal_key


class _Req:
    """Minimal stand-in for starlette's Request — only .headers is read."""

    def __init__(self, headers=None):
        self.headers = headers or {}


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("INTERNAL_KEY", raising=False)


def test_unset_key_refuses_every_request(monkeypatch):
    # The important one: no default, so a misconfigured deploy fails closed
    # instead of falling back to a publicly known secret.
    with pytest.raises(HTTPException) as exc:
        require_internal_key(_Req({"X-Internal-Key": "homly-internal"}))
    assert exc.value.status_code == 503
    assert internal_key() is None


def test_blank_key_is_treated_as_unset(monkeypatch):
    monkeypatch.setenv("INTERNAL_KEY", "   ")
    with pytest.raises(HTTPException) as exc:
        require_internal_key(_Req({"X-Internal-Key": "   "}))
    assert exc.value.status_code == 503


def test_correct_key_passes(monkeypatch):
    monkeypatch.setenv("INTERNAL_KEY", "s3cret")
    require_internal_key(_Req({"X-Internal-Key": "s3cret"}))  # no raise


def test_wrong_key_is_forbidden(monkeypatch):
    monkeypatch.setenv("INTERNAL_KEY", "s3cret")
    with pytest.raises(HTTPException) as exc:
        require_internal_key(_Req({"X-Internal-Key": "nope"}))
    assert exc.value.status_code == 403


def test_missing_header_is_forbidden(monkeypatch):
    monkeypatch.setenv("INTERNAL_KEY", "s3cret")
    with pytest.raises(HTTPException) as exc:
        require_internal_key(_Req({}))
    assert exc.value.status_code == 403


def test_old_hardcoded_default_no_longer_opens_anything(monkeypatch):
    monkeypatch.setenv("INTERNAL_KEY", "s3cret")
    with pytest.raises(HTTPException):
        require_internal_key(_Req({"X-Internal-Key": "homly-internal"}))


def test_env_is_read_per_call_not_cached_at_import(monkeypatch):
    monkeypatch.setenv("INTERNAL_KEY", "first")
    require_internal_key(_Req({"X-Internal-Key": "first"}))
    monkeypatch.setenv("INTERNAL_KEY", "second")
    require_internal_key(_Req({"X-Internal-Key": "second"}))
    with pytest.raises(HTTPException):
        require_internal_key(_Req({"X-Internal-Key": "first"}))


# ── has_internal_key: the non-raising variant /webhook/whatsapp uses ────────

def test_has_internal_key_false_when_unset(monkeypatch):
    assert has_internal_key(_Req({"X-Internal-Key": "homly-internal"})) is False


def test_has_internal_key_matches(monkeypatch):
    monkeypatch.setenv("INTERNAL_KEY", "s3cret")
    assert has_internal_key(_Req({"X-Internal-Key": "s3cret"})) is True
    assert has_internal_key(_Req({"X-Internal-Key": "wrong"})) is False
    assert has_internal_key(_Req({})) is False
