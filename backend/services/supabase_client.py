"""The one Supabase client the backend uses, hardened against transient
connection faults.

**Why this module exists.** Supabase's edge terminates idle/long-lived
connections on its own schedule. Because supabase-py talks HTTP/2 by default,
that arrives as an h2 GOAWAY frame and httpx raises it in the middle of a
perfectly valid request:

    httpx.RemoteProtocolError: <ConnectionTerminated error_code:0,
                                last_stream_id:3, additional_data:None>
    httpx.RemoteProtocolError: Server disconnected without sending a response

`error_code:0` is NO_ERROR — a *graceful* shutdown — and `last_stream_id` is the
server telling us which streams it actually processed. Anything numbered above
it was never handled, so re-sending it is correct rather than merely hopeful.
Every occurrence of this in production has been one of these two, on an
otherwise healthy database.

Nothing retried them, so each one surfaced as a user-visible failure:
`GET /household` returning `{"household": null}` (the middleware caught the
error and fell through to "this user has no household", which sends an existing
member to `/onboarding`), or a 500 with a raw traceback when the same fault hit
a router's own query instead.

**What this does.** One process-wide client built on one httpx client whose
transport retries these faults (`get_supabase()`). Every module that used to
call `create_client()` itself now calls this, so the retry applies to the
dashboard API, the WhatsApp graph, the agents and the scheduler alike — and the
backend stops opening ~40 independent connection pools to the same database.

**What this deliberately does not do.**

* It does not retry read/write timeouts. A slow query retried three times is
  three times the load on a database that is already struggling, and the
  request may well have been applied server-side.
* It does not retry non-idempotent methods (POST/PATCH/PUT/DELETE) on a
  mid-flight fault. "Server disconnected without sending a response" does not
  prove the write was not applied — only that we never saw the answer — and a
  duplicated receipt, reimbursement or chore log is worse than a surfaced
  error. Those methods are retried only on connect-level faults, where the
  request provably never left this process.
* It does not tune keepalive expiry. httpx already expires idle pooled
  connections after 5s; the GOAWAY race is not "we kept a dead connection too
  long", it is "the server closed as we were writing", which no timeout value
  prevents.
"""
import importlib.util
import logging
import os
import threading
import time
from typing import Optional

import httpx
from dotenv import load_dotenv
from supabase import Client, ClientOptions, create_client

load_dotenv()

logger = logging.getLogger(__name__)

# 3 attempts = the original + 2 retries. A GOAWAY race resolves on the first
# retry (the pooled connection is gone, so the retry opens a fresh one); more
# attempts than this would only be papering over a genuinely unreachable
# database, which should surface as an error instead.
_ATTEMPTS = 3
_BACKOFF_SECONDS = 0.25

# Methods safe to replay wholesale: they change nothing server-side.
_IDEMPOTENT_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

# The request never left this process, so replaying it is safe for any method.
_NEVER_SENT = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.PoolTimeout,
)

# The connection died somewhere between "request written" and "response read"
# — the GOAWAY case, plus httpx's NetworkError family (ReadError, WriteError,
# CloseError; ConnectError is also one, but _NEVER_SENT is checked first and
# already covers it). Safe to replay only for the idempotent methods above.
_MID_FLIGHT = (
    httpx.RemoteProtocolError,
    httpx.NetworkError,
)

# Matches postgrest-py's own default (120s total) so adopting this client
# doesn't quietly tighten the timeout on existing queries; the connect phase
# is capped much lower, since a connect that slow is a dead host, not a slow
# query.
_TIMEOUT = httpx.Timeout(120.0, connect=10.0)


def _is_replayable(request: httpx.Request) -> bool:
    """False for a request whose body is a one-shot stream (a file upload).

    Re-sending one of those would send an empty or truncated body, so such a
    request is never retried regardless of the fault.
    """
    try:
        request.content
    except httpx.RequestNotRead:
        return False
    return True


def _should_retry(request: httpx.Request, exc: Exception) -> bool:
    if not _is_replayable(request):
        return False
    if isinstance(exc, _NEVER_SENT):
        return True
    if isinstance(exc, _MID_FLIGHT):
        return request.method.upper() in _IDEMPOTENT_METHODS
    return False


class RetryTransport(httpx.BaseTransport):
    """Wraps an httpx transport, replaying requests lost to a transient fault.

    Sits at the transport layer rather than at each `.execute()` call site so
    every Supabase call in the backend is covered by construction — a new query
    cannot forget to opt in.
    """

    def __init__(
        self,
        inner: httpx.BaseTransport,
        attempts: int = _ATTEMPTS,
        backoff_seconds: float = _BACKOFF_SECONDS,
        sleep=time.sleep,
    ) -> None:
        self._inner = inner
        self._attempts = max(1, attempts)
        self._backoff_seconds = backoff_seconds
        self._sleep = sleep

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        last_exc: Optional[Exception] = None
        for attempt in range(1, self._attempts + 1):
            try:
                return self._inner.handle_request(request)
            except Exception as exc:
                if attempt == self._attempts or not _should_retry(request, exc):
                    raise
                last_exc = exc
                delay = self._backoff_seconds * (2 ** (attempt - 1))
                logger.warning(
                    "[supabase] %s %s failed with %s: %s — retrying in %.2fs (attempt %d/%d)",
                    request.method, request.url.path, type(exc).__name__, exc,
                    delay, attempt + 1, self._attempts,
                )
                self._sleep(delay)
        # Unreachable: the loop either returns or raises.
        raise last_exc  # pragma: no cover

    def close(self) -> None:
        self._inner.close()


def _env_proxy(target_host: str) -> Optional[str]:
    """The proxy httpx would have picked up from the environment itself.

    Passing an explicit `transport=` to `httpx.Client` turns off its own
    environment-proxy handling (`allow_env_proxies = trust_env and transport is
    None`), so read it back here rather than silently dropping a deployment's
    proxy configuration. Supabase is always reached over https, so only the
    https/all variables matter, and NO_PROXY is honoured as plain host-suffix
    matching — enough for one known host, not the full spec httpx implements.
    """
    no_proxy = os.getenv("NO_PROXY") or os.getenv("no_proxy") or ""
    host = (target_host or "").lower()
    for pattern in (p.strip().lstrip(".").lower() for p in no_proxy.split(",")):
        if pattern and (pattern == "*" or host == pattern or host.endswith(f".{pattern}")):
            return None
    for var in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"):
        value = os.getenv(var)
        if value:
            return value
    return None


def _build_httpx_client(supabase_url: str) -> httpx.Client:
    # supabase-py's own clients ask for HTTP/2, so match that rather than
    # quietly changing the protocol this backend speaks. `h2` is an optional
    # httpx dependency and httpcore only raises for a missing one at request
    # time, so check up front: HTTP/1.1 hits the same idle-close race and the
    # same retry path, it just loses multiplexing.
    http2 = importlib.util.find_spec("h2") is not None
    if not http2:
        logger.warning("[supabase] h2 not installed — using HTTP/1.1")
    inner = httpx.HTTPTransport(http2=http2, proxy=_env_proxy(httpx.URL(supabase_url).host))
    return httpx.Client(
        transport=RetryTransport(inner),
        timeout=_TIMEOUT,
        follow_redirects=True,
    )


_client: Optional[Client] = None
_lock = threading.Lock()


def get_supabase() -> Client:
    """The shared service-role Supabase client. Thread-safe, built on first use.

    Built on first call rather than at import of this module, so importing it
    doesn't require `SUPABASE_URL`/`SUPABASE_KEY` to be set. (The routers that
    keep a module-level `supabase = get_supabase()` still need them at their own
    import time — exactly as they did when they called `create_client()` there.)
    """
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                url = os.getenv("SUPABASE_URL")
                _client = create_client(
                    url,
                    os.getenv("SUPABASE_KEY"),
                    ClientOptions(httpx_client=_build_httpx_client(url)),
                )
    return _client
