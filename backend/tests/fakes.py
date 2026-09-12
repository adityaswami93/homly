"""A single in-process stand-in for the Supabase client.

Every test file that needed a database used to hand-roll its own
`_FakeTable`/`_FakeQuery` pair — test_reimbursement_totals.py and
test_conversation_context.py each grew a different one, supporting a different
subset of the query builder. That is the same drift CLAUDE.md's "Backend stays
DRY" rule warns about, one layer down: two fakes that disagree about what
Supabase does mean two tests that agree with each other and neither with
production.

This is the one fake. It covers the builder surface this codebase actually
uses, applies filters to seeded rows so a query returns something plausible
rather than everything, and — the part that earns its keep — **records every
call**, so a test can assert on the filters that were applied and not merely
on the rows that came back.

Usage:

    db = FakeSupabase({"receipts": [{"id": "r1", "household_id": "hh-1"}]})
    rows = db.table("receipts").select("*").eq("household_id", "hh-1").execute().data

    assert db.filters("receipts") == [("eq", "household_id", "hh-1")]
    assert_scoped_to(db, "hh-1")

Deliberately not a Postgres emulator. There is no join support, no `or_`, no
ordering by multiple keys, and `order()` only sorts by a single column. When a
test needs more than this, the honest move is usually that the code under test
wants a smaller, purer function — not that this file needs a query planner.
"""
from __future__ import annotations

from typing import Any, NamedTuple

# Tables carrying a household_id column, per CLAUDE.md's "Database Schema".
# Kept in sync with HOUSEHOLD_SCOPED_TABLES in tests/check_household_scoping.py —
# that one guards the invariant statically, this one dynamically.
HOUSEHOLD_SCOPED_TABLES = {
    "receipts", "items", "settings", "insurance_policies",
    "chores", "chore_logs", "helper_leave_requests", "helper_profile",
    "reimbursements", "pantry_items", "pantry_pending_confirmations",
    "price_history", "household_preferences", "proactive_notification_log",
    "api_keys", "shopping_list", "budgets", "savings_accounts", "reminders",
    "conversation_messages",
}


class Call(NamedTuple):
    """One completed query against one table."""
    table: str
    op: str                      # select / insert / update / upsert / delete
    filters: list[tuple]         # ("eq", column, value), ("in_", column, [...]), ...
    payload: Any                 # the row(s) written, for insert/update/upsert


class _Response:
    """Stands in for postgrest's APIResponse — callers only ever read .data."""

    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Query:
    def __init__(self, db: "FakeSupabase", table: str):
        self._db = db
        self._table = table
        self._op = "select"
        self._filters: list[tuple] = []
        self._payload: Any = None
        self._order: tuple[str, bool] | None = None
        self._limit: int | None = None
        self._single = False

    # ── terminal operations ────────────────────────────────────────────────
    def select(self, *_columns, **_kwargs):
        self._op = "select"
        return self

    def insert(self, payload, **_kwargs):
        self._op, self._payload = "insert", payload
        return self

    def update(self, payload, **_kwargs):
        self._op, self._payload = "update", payload
        return self

    def upsert(self, payload, **_kwargs):
        self._op, self._payload = "upsert", payload
        return self

    def delete(self, **_kwargs):
        self._op = "delete"
        return self

    # ── filters ────────────────────────────────────────────────────────────
    def _filter(self, kind, column, value):
        self._filters.append((kind, column, value))
        return self

    def eq(self, column, value):        return self._filter("eq", column, value)
    def neq(self, column, value):       return self._filter("neq", column, value)
    def gt(self, column, value):        return self._filter("gt", column, value)
    def gte(self, column, value):       return self._filter("gte", column, value)
    def lt(self, column, value):        return self._filter("lt", column, value)
    def lte(self, column, value):       return self._filter("lte", column, value)
    def like(self, column, value):      return self._filter("like", column, value)
    def ilike(self, column, value):     return self._filter("ilike", column, value)
    def is_(self, column, value):       return self._filter("is_", column, value)
    def in_(self, column, values):      return self._filter("in_", column, list(values))
    def contains(self, column, value):  return self._filter("contains", column, value)

    # ── modifiers ──────────────────────────────────────────────────────────
    def order(self, column, desc=False, **_kwargs):
        self._order = (column, desc)
        return self

    def limit(self, n, **_kwargs):
        self._limit = n
        return self

    def range(self, start, end, **_kwargs):
        self._limit = end - start + 1
        return self

    def single(self):
        self._single = True
        return self

    def maybe_single(self):
        self._single = True
        return self

    # ── execution ──────────────────────────────────────────────────────────
    def execute(self):
        self._db.calls.append(Call(self._table, self._op, list(self._filters), self._payload))
        rows = self._db.rows.setdefault(self._table, [])

        if self._op == "select":
            result = [r for r in rows if self._matches(r)]
            if self._order:
                column, desc = self._order
                # Rows missing the sort key sort last rather than raising, which
                # is what a NULL would do here; a fake that blows up on partial
                # seed data just makes tests carry irrelevant columns.
                result = sorted(
                    result,
                    key=lambda r: (r.get(column) is None, r.get(column)),
                    reverse=desc,
                )
            if self._limit is not None:
                result = result[: self._limit]
            if self._single:
                return _Response(result[0] if result else None)
            return _Response(result)

        if self._op in ("insert", "upsert"):
            written = self._payload if isinstance(self._payload, list) else [self._payload]
            stored = []
            for row in written:
                row = {**row}
                row.setdefault("id", f"{self._table}-{len(rows) + len(stored) + 1}")
                stored.append(row)
            rows.extend(stored)
            return _Response(stored)

        if self._op == "update":
            touched = []
            for row in rows:
                if self._matches(row):
                    row.update(self._payload or {})
                    touched.append(row)
            return _Response(touched)

        if self._op == "delete":
            removed = [r for r in rows if self._matches(r)]
            self._db.rows[self._table] = [r for r in rows if not self._matches(r)]
            return _Response(removed)

        raise AssertionError(f"FakeSupabase does not implement op {self._op!r}")

    def _matches(self, row: dict) -> bool:
        for kind, column, value in self._filters:
            actual = row.get(column)
            if kind == "eq" and actual != value:
                return False
            if kind == "neq" and actual == value:
                return False
            if kind == "in_" and actual not in value:
                return False
            if kind == "is_":
                # postgrest spells NULL as the string "null".
                wanted_null = value in (None, "null")
                if wanted_null != (actual is None):
                    return False
            if actual is None and kind in ("gt", "gte", "lt", "lte"):
                return False
            if kind == "gt" and not actual > value:
                return False
            if kind == "gte" and not actual >= value:
                return False
            if kind == "lt" and not actual < value:
                return False
            if kind == "lte" and not actual <= value:
                return False
            if kind in ("like", "ilike"):
                needle = str(value).replace("%", "")
                haystack = str(actual or "")
                if kind == "ilike":
                    needle, haystack = needle.lower(), haystack.lower()
                if needle not in haystack:
                    return False
            if kind == "contains":
                items = actual or []
                wanted = value if isinstance(value, (list, tuple, set)) else [value]
                if not all(w in items for w in wanted):
                    return False
        return True


class FakeSupabase:
    """Drop-in for the object `services.db.get_supabase()` returns.

    Seed it with `{table_name: [row, ...]}`; anything not seeded starts empty.
    """

    def __init__(self, rows: dict[str, list[dict]] | None = None):
        self.rows: dict[str, list[dict]] = {k: [dict(r) for r in v] for k, v in (rows or {}).items()}
        self.calls: list[Call] = []

    def table(self, name: str) -> _Query:
        return _Query(self, name)

    # supabase-py exposes .from_() as an alias for .table().
    def from_(self, name: str) -> _Query:
        return self.table(name)

    # ── assertions helpers ────────────────────────────────────────────────
    def filters(self, table: str) -> list[tuple]:
        """Every filter applied to `table`, flattened across all calls."""
        return [f for c in self.calls if c.table == table for f in c.filters]

    def calls_for(self, table: str) -> list[Call]:
        return [c for c in self.calls if c.table == table]


def unscoped_calls(db: FakeSupabase, household_id: str) -> list[Call]:
    """Calls against a household-scoped table that neither filtered on nor wrote
    `household_id = household_id`.

    This is the runtime counterpart to tests/check_household_scoping.py. The
    static scanner reads code and can be fooled by indirection; this reads what
    a request actually did. CLAUDE.md is explicit that RLS is disabled on these
    tables and application code is the only thing preventing a cross-household
    read or write, so "the endpoint returned the right rows" is not the property
    worth asserting — "the query could not have returned anyone else's" is.
    """
    offenders = []
    for call in db.calls:
        if call.table not in HOUSEHOLD_SCOPED_TABLES:
            continue
        filtered = any(
            column == "household_id" and value == household_id
            for _kind, column, value in call.filters
        )
        written = call.payload if isinstance(call.payload, list) else [call.payload]
        carried = any(
            isinstance(row, dict) and row.get("household_id") == household_id
            for row in written
        )
        if not (filtered or carried):
            offenders.append(call)
    return offenders


def assert_scoped_to(db: FakeSupabase, household_id: str) -> None:
    offenders = unscoped_calls(db, household_id)
    assert not offenders, (
        f"{len(offenders)} query/queries on a household-scoped table did not scope to "
        f"{household_id!r} — a cross-household read or write:\n"
        + "\n".join(f"  {c.table}.{c.op} filters={c.filters} payload={c.payload}" for c in offenders)
    )
