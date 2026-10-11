"""GET /internal/wa-auth must return every session row, not PostgREST's first 1000.

PostgREST truncates a SELECT at the project's max-rows without signalling it.
The bot treats a load with no `creds` row as "never paired", so a truncated
load that happened to drop `creds` used to unpair the bot. See documents/041-*.
"""

import pytest

from api.routers import wa_auth


class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows, calls):
        self._rows = rows
        self._calls = calls
        self._range = None

    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def order(self, *_):
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        self._calls.append(self._range)
        start, end = self._range
        # Mimic the server-side cap: never more than a page, whatever is asked.
        return _Res(self._rows[start:min(end + 1, start + wa_auth.LOAD_PAGE_SIZE)])


class _DB:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def table(self, _):
        return _Query(self.rows, self.calls)


@pytest.fixture
def _db(monkeypatch):
    monkeypatch.setattr(wa_auth, "require_internal_key", lambda _req: None)

    def install(rows):
        db = _DB(rows)
        monkeypatch.setattr(wa_auth, "_db", lambda: db)
        return db

    return install


def _rows(n):
    rows = [{"key": f"pre-key|{i:05d}", "value": "v"} for i in range(n)]
    if n > wa_auth.LOAD_PAGE_SIZE:
        # Put `creds` past the first page — the case truncation used to lose.
        rows[wa_auth.LOAD_PAGE_SIZE + 1] = {"key": "creds", "value": "c"}
    return rows


def test_load_pages_past_the_row_cap(_db):
    rows = _rows(2500)
    db = _db(rows)

    out = wa_auth.load_auth_state(request=None, tenant_id="default")

    assert len(out["rows"]) == len(rows)
    assert any(r["key"] == "creds" for r in out["rows"])
    assert db.calls == [(0, 999), (1000, 1999), (2000, 2999)]


def test_load_exact_multiple_stops_on_empty_page(_db):
    db = _db(_rows(wa_auth.LOAD_PAGE_SIZE))

    out = wa_auth.load_auth_state(request=None, tenant_id="default")

    assert len(out["rows"]) == wa_auth.LOAD_PAGE_SIZE
    assert db.calls == [(0, 999), (1000, 1999)]


def test_load_empty_tenant(_db):
    _db([])
    assert wa_auth.load_auth_state(request=None, tenant_id="default") == {"rows": []}
