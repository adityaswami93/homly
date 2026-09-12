"""services/db.py's retry transport — the fix for Supabase GOAWAY 500s.

Reproduces the production failure without a network: an inner transport that
raises exactly what httpx raised on Railway (`RemoteProtocolError` carrying h2's
`ConnectionTerminated`), and asserts the request is re-sent instead of reaching
the caller as a 500.
"""
import pytest

pytest.importorskip("httpx")
pytest.importorskip("supabase")

import httpx  # noqa: E402

from services import db  # noqa: E402

# The exact string httpx produced in the Railway logs — services/db.py matches
# on it to tell a graceful GOAWAY (nothing was processed) from any other
# protocol error, so a change to it is a behaviour change, not a cosmetic one.
GOAWAY = httpx.RemoteProtocolError(
    "<ConnectionTerminated error_code:0, last_stream_id:3, additional_data:None>"
)


class _Flaky(httpx.BaseTransport):
    """Fails the first `failures` requests, then answers 200."""

    def __init__(self, failures: int, exc: Exception = GOAWAY):
        self.failures = failures
        self.exc = exc
        self.calls = 0

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if self.calls <= self.failures:
            raise self.exc
        return httpx.Response(200, json={"ok": True}, request=request)


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch):
    monkeypatch.setattr(db, "_BACKOFF_SECONDS", 0)


def _send(transport, method="GET", **kwargs):
    retrying = db._RetryTransport(transport)
    request = httpx.Request(method, "https://example.supabase.co/rest/v1/receipts", **kwargs)
    return retrying.handle_request(request)


def test_get_retried_after_goaway():
    inner = _Flaky(failures=1)
    response = _send(inner)
    assert response.status_code == 200
    assert inner.calls == 2


def test_gives_up_after_max_attempts():
    inner = _Flaky(failures=99)
    with pytest.raises(httpx.RemoteProtocolError):
        _send(inner)
    assert inner.calls == db._MAX_ATTEMPTS


def test_get_retried_after_connect_error():
    inner = _Flaky(failures=1, exc=httpx.ConnectError("connection refused"))
    assert _send(inner).status_code == 200
    assert inner.calls == 2


def test_write_retried_only_when_nothing_was_processed():
    # A GOAWAY names the last stream the server handled, so an insert that
    # died on a later stream provably never ran and is safe to re-send.
    inner = _Flaky(failures=1)
    assert _send(inner, method="POST", json={"vendor": "NTUC"}).status_code == 200
    assert inner.calls == 2


def test_write_not_retried_on_ambiguous_failure():
    # A read error mid-request could mean the insert landed and the response
    # was lost — re-sending it would duplicate the row.
    inner = _Flaky(failures=1, exc=httpx.ReadError("connection reset"))
    with pytest.raises(httpx.ReadError):
        _send(inner, method="POST", json={"vendor": "NTUC"})
    assert inner.calls == 1


def test_streaming_body_not_replayed():
    # A receipt image on its way to Supabase Storage has a one-shot body.
    def _chunks():
        yield b"jpeg-bytes"

    inner = _Flaky(failures=1)
    with pytest.raises(httpx.RemoteProtocolError):
        _send(inner, method="POST", content=_chunks())
    assert inner.calls == 1


def test_status_errors_are_not_retried():
    class _ServerError(httpx.BaseTransport):
        def __init__(self):
            self.calls = 0

        def handle_request(self, request):
            self.calls += 1
            return httpx.Response(500, request=request)

    inner = _ServerError()
    assert db._RetryTransport(inner).handle_request(
        httpx.Request("GET", "https://example.supabase.co/rest/v1/receipts")
    ).status_code == 500
    assert inner.calls == 1


def test_install_retries_wraps_a_client_once():
    client = httpx.Client()
    db._install_retries(client)
    wrapped = client._transport
    assert isinstance(wrapped, db._RetryTransport)
    db._install_retries(client)
    assert client._transport is wrapped


def test_iter_httpx_clients_finds_nested_sessions():
    # Shaped like a supabase Client: sub-clients holding their own httpx one.
    class _Sub:
        def __init__(self):
            self.session = httpx.Client()

    class _Root:
        def __init__(self):
            self.postgrest = _Sub()
            self.auth = _Sub()

    root = _Root()
    found = list(db._iter_httpx_clients(root))
    assert {id(c) for c in found} == {id(root.postgrest.session), id(root.auth.session)}
