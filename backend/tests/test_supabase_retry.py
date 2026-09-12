"""services/supabase_client.py's RetryTransport — the retry rules, not the client.

The faults being reproduced here are the ones production actually logged:

    httpx.RemoteProtocolError: <ConnectionTerminated error_code:0, last_stream_id:3>
    httpx.RemoteProtocolError: Server disconnected without sending a response

The interesting half of this is what *isn't* retried: a mid-flight fault on a
POST/PATCH/DELETE could mean the write landed and only the response was lost,
so replaying it risks a duplicate receipt or reimbursement.
"""
import os

import httpx
import pytest

from services.supabase_client import RetryTransport, _build_httpx_client, _env_proxy

_URL = "https://example.supabase.co/rest/v1/household_members"

# The exact h2 GOAWAY text httpx surfaces for a graceful server shutdown.
GOAWAY = httpx.RemoteProtocolError(
    "<ConnectionTerminated error_code:0, last_stream_id:3, additional_data:None>"
)
DISCONNECTED = httpx.RemoteProtocolError("Server disconnected without sending a response")


class FakeTransport(httpx.BaseTransport):
    """Raises the queued faults in order, then returns 200."""

    def __init__(self, *faults):
        self.faults = list(faults)
        self.calls = 0

    def handle_request(self, request):
        self.calls += 1
        if self.faults:
            raise self.faults.pop(0)
        return httpx.Response(200, json=[{"household_id": "h1", "role": "admin"}])


def _transport(inner, attempts=3):
    delays = []
    return RetryTransport(inner, attempts=attempts, backoff_seconds=0.25,
                          sleep=delays.append), delays


def _send(transport, method="GET", **kwargs):
    return transport.handle_request(httpx.Request(method, _URL, **kwargs))


@pytest.mark.parametrize("fault", [GOAWAY, DISCONNECTED])
def test_get_is_retried_after_a_graceful_connection_close(fault):
    inner = FakeTransport(fault)
    transport, delays = _transport(inner)

    response = _send(transport)

    assert response.status_code == 200
    assert inner.calls == 2
    assert delays == [0.25]


def test_retries_are_capped_and_the_last_fault_surfaces():
    inner = FakeTransport(GOAWAY, GOAWAY, GOAWAY)
    transport, delays = _transport(inner)

    with pytest.raises(httpx.RemoteProtocolError):
        _send(transport)

    assert inner.calls == 3
    assert delays == [0.25, 0.5]  # exponential, and none after the final attempt


def test_write_is_not_replayed_after_a_mid_flight_fault():
    # The write may have been applied server-side; only the response was lost.
    inner = FakeTransport(DISCONNECTED)
    transport, _ = _transport(inner)

    with pytest.raises(httpx.RemoteProtocolError):
        _send(transport, method="POST", json={"vendor": "NTUC"})

    assert inner.calls == 1


@pytest.mark.parametrize("method", ["POST", "PATCH", "DELETE"])
def test_write_is_retried_when_the_request_never_left_the_process(method):
    inner = FakeTransport(httpx.ConnectError("connection refused"))
    transport, _ = _transport(inner)

    assert _send(transport, method=method, json={"vendor": "NTUC"}).status_code == 200
    assert inner.calls == 2


def test_read_timeout_is_not_retried():
    # A slow query retried three times is three times the load on a database
    # that is already struggling — and it may have been applied anyway.
    inner = FakeTransport(httpx.ReadTimeout("timed out"))
    transport, _ = _transport(inner)

    with pytest.raises(httpx.ReadTimeout):
        _send(transport)

    assert inner.calls == 1


def test_status_errors_are_left_alone():
    # 500s and 429s come back as responses, not exceptions: PostgREST error
    # handling belongs to the caller, not to this transport.
    class Failing(FakeTransport):
        def handle_request(self, request):
            self.calls += 1
            return httpx.Response(500, json={"message": "boom"})

    inner = Failing()
    transport, _ = _transport(inner)

    assert _send(transport).status_code == 500
    assert inner.calls == 1


def test_unreplayable_body_is_never_retried():
    # A streaming upload (a receipt image) can't be re-sent: the body has
    # already been consumed, so a retry would send a truncated one.
    inner = FakeTransport(httpx.ConnectError("connection refused"))
    transport, _ = _transport(inner)

    with pytest.raises(httpx.ConnectError):
        transport.handle_request(
            httpx.Request("POST", _URL, content=iter([b"jpeg-bytes"]))
        )

    assert inner.calls == 1


def test_client_is_built_on_the_retry_transport():
    # Passing `transport=` is what makes the retry apply to every Supabase
    # call, and it's also what disables httpx's own env-proxy handling —
    # hence _env_proxy() and the mounts assertion below.
    client = _build_httpx_client("https://abc.supabase.co")
    try:
        assert isinstance(client._transport, RetryTransport)
        assert client._mounts == {}
    finally:
        client.close()


def test_env_proxy_honours_https_proxy_and_no_proxy():
    keys = ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy")
    saved = {k: os.environ.get(k) for k in keys}
    try:
        for k in keys:
            os.environ.pop(k, None)
        assert _env_proxy("abc.supabase.co") is None

        os.environ["HTTPS_PROXY"] = "http://proxy.internal:8080"
        assert _env_proxy("abc.supabase.co") == "http://proxy.internal:8080"

        os.environ["NO_PROXY"] = ".supabase.co,localhost"
        assert _env_proxy("abc.supabase.co") is None
        assert _env_proxy("other.example.com") == "http://proxy.internal:8080"
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
