"""The backend's one Supabase client, hardened against dropped connections.

Two problems, one module.

**Stale HTTP/2 connections.** Supabase's edge serves a couple of requests on a
pooled HTTP/2 connection and then closes it gracefully — a GOAWAY frame, which
h2 surfaces as `ConnectionTerminated error_code:0, last_stream_id:3`. httpx
keeps that connection in its pool regardless, so the next request sent on it
dies before it ever receives a response and comes back as
`httpx.RemoteProtocolError`. In production that read as a dashboard 500:
28 of them between 05:54 and 06:00 on 2026-09-12 (Railway logs), 25 on
`GET /household` alone, each dying on the *third* Supabase query of the handler
with the two before it having just succeeded. Nothing was wrong with the query,
the data or the JWT — the request just landed on a connection the server had
already said goodbye to.
`_RetryTransport` below re-sends such a request on a fresh connection.

**One connection pool per module.** Every router, service and agent used to
build its own `create_client(os.getenv("SUPABASE_URL"), ...)` at import — 40 of
them, each with its own pool, each independently exposed to the above, and no
single place to fix it. `get_supabase()` is now the only constructor in the
backend (CLAUDE.md: "Backend stays DRY"), so the retry policy is defined once.
New code calls `get_supabase()`; it must not call `create_client` directly.

What this module deliberately does *not* do: retry on HTTP status codes. A 4xx
or 5xx from PostgREST is an answer — the caller's own error handling owns it.
The only thing retried here is a connection that died with no answer at all.
"""
import logging
import os
import threading
import time
from types import ModuleType
from typing import Iterator

import httpx
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = 0.05

# Transport-level failures: httpx raises these from `handle_request()`, i.e.
# before any response headers exist, so the caller has read nothing and a
# re-send can't interleave with a half-consumed response body. (An error that
# strikes mid-body surfaces later, while reading the stream, and is not caught
# here.)
_CONNECTION_ERRORS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadError,
    httpx.RemoteProtocolError,
    httpx.WriteError,
)

_IDEMPOTENT_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _server_never_processed_it(exc: Exception) -> bool:
    """True when the failure itself proves the request was not acted on.

    A connect error means the bytes never left the process. A graceful HTTP/2
    GOAWAY names the last stream the server processed and promises it processed
    nothing after that one — which is why re-sending an insert is safe in that
    specific case. httpx flattens the h2 event into the exception message
    (`<ConnectionTerminated error_code:0, last_stream_id:3, ...>`); that string
    is the only place the detail survives the httpcore→httpx mapping, so it is
    what we match on. A miss here is not a correctness problem: the request
    simply isn't retried and the caller sees the error it sees today.
    """
    if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout)):
        return True
    return isinstance(exc, httpx.RemoteProtocolError) and "ConnectionTerminated" in str(exc)


def _is_replayable(request: httpx.Request) -> bool:
    """Can this request's body be sent a second time?

    Requests built from bytes (everything PostgREST and GoTrue send) can.
    A streaming upload — a receipt image on its way to Supabase Storage — has
    a one-shot body iterator, and `.content` raises rather than replaying it.
    """
    try:
        request.content
    except httpx.RequestNotRead:
        return False
    return True


def _should_retry(request: httpx.Request, exc: Exception) -> bool:
    if not _is_replayable(request):
        return False
    if request.method in _IDEMPOTENT_METHODS:
        return True
    # A write is only retried when the error proves nothing was written —
    # otherwise a lost *response* to a successful insert would become a
    # duplicate row, which is a worse failure than the 500 this module fixes.
    return _server_never_processed_it(exc)


class _RetryTransport(httpx.BaseTransport):
    """Wraps another transport, re-sending requests that got no response.

    Retrying is all this needs to do: httpcore won't hand out an HTTP/2
    connection it has already seen a GOAWAY on (such a connection is no longer
    `is_available()`), so the next attempt dials a fresh one by itself.
    """

    def __init__(self, inner: httpx.BaseTransport):
        self._inner = inner

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        attempt = 0
        while True:
            attempt += 1
            try:
                return self._inner.handle_request(request)
            except _CONNECTION_ERRORS as exc:
                if attempt >= _MAX_ATTEMPTS or not _should_retry(request, exc):
                    raise
                logger.warning(
                    "Supabase connection dropped on %s %s (attempt %d/%d): %s — retrying",
                    request.method, request.url, attempt, _MAX_ATTEMPTS, exc,
                )
                time.sleep(_BACKOFF_SECONDS * attempt)

    def close(self) -> None:
        self._inner.close()


# supabase-py builds its own httpx clients, and httpx exposes no public hook
# for swapping the transport of a client that already exists. `_transport` and
# `_mounts` are where httpx.Client has stored them since 0.20; we only read and
# wrap what's there, never reimplement it.
def _install_retries(session: httpx.Client) -> None:
    if not isinstance(session._transport, _RetryTransport):
        session._transport = _RetryTransport(session._transport)
    for pattern, mounted in list(session._mounts.items()):
        if mounted is not None and not isinstance(mounted, _RetryTransport):
            session._mounts[pattern] = _RetryTransport(mounted)


_SCAN_DEPTH = 4


def _iter_httpx_clients(root: object) -> Iterator[httpx.Client]:
    """Find the httpx clients inside a supabase Client.

    Walked rather than named: the sub-clients live at attribute paths that have
    moved between supabase-py versions (`postgrest.session`,
    `auth._http_client`, ...), and pinning those names means a dependency bump
    silently turns the retries off. A bounded walk of `__dict__`s finds them
    wherever they sit, and `get_supabase()` logs loudly if it finds none.
    """
    seen: set[int] = set()
    queue: list[tuple[object, int]] = [(root, 0)]
    while queue:
        obj, depth = queue.pop()
        if id(obj) in seen:
            continue
        seen.add(id(obj))
        if isinstance(obj, httpx.Client):
            yield obj
            continue
        if depth >= _SCAN_DEPTH:
            continue
        for value in list(getattr(obj, "__dict__", {}).values()):
            if isinstance(value, httpx.Client):
                queue.append((value, depth + 1))
            elif isinstance(value, (ModuleType, type)) or callable(value):
                # An imported module or a class held as an attribute leads into
                # library internals, not into this client's own sessions.
                continue
            elif hasattr(value, "__dict__"):
                queue.append((value, depth + 1))


# .postgrest/.storage/.functions are built on first access, so they have to be
# touched before the walk — otherwise it inspects a client whose httpx sessions
# don't exist yet and hardens nothing.
_SUBCLIENTS = ("auth", "postgrest", "storage", "functions")


def _harden(client: object) -> int:
    for attr in _SUBCLIENTS:
        try:
            getattr(client, attr)
        except Exception as e:
            # A sub-client this backend never uses failing to build is not
            # fatal — storage, say, on a deploy with no storage configured.
            logger.debug("Supabase sub-client %s unavailable: %s", attr, e)
    count = 0
    for session in _iter_httpx_clients(client):
        _install_retries(session)
        count += 1
    return count


_client = None
_client_lock = threading.Lock()


def get_supabase():
    """The shared service-key Supabase client. Cheap to call; built once."""
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is None:
            client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
            hardened = _harden(client)
            if hardened:
                logger.info("Supabase client ready — retry transport on %d httpx session(s)", hardened)
            else:
                logger.warning(
                    "Supabase client ready but no httpx session was found to wrap: dropped "
                    "connections will surface as 500s again. supabase-py's internals have "
                    "moved — see _iter_httpx_clients in services/db.py"
                )
            _client = client
    return _client
