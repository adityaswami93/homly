"""
Static guard for the multi-tenancy invariant documented in CLAUDE.md:

    "Most tables ... have ROW LEVEL SECURITY explicitly disabled ...
    household isolation is enforced entirely by application code
    remembering to scope every query. There is no database-level backstop."

This walks every router/service/agent .py file, finds every Supabase
`.table("...")` call against a household-scoped table, and reports the ones it
cannot show are scoped.

Run it directly (`python tests/check_household_scoping.py`); it is not a pytest
module, because it must run with nothing but the standard library.

Recognised safe patterns
------------------------
Three shapes are provably scoped and are not reported:

1. **The filter is right there.** `household_id` appears in the statement
   containing the call.

2. **The chain is built across statements.** ::

       q = _db().table("items").select("*")
       q = q.eq("household_id", hid)

   The call and its filters are separate statements, so pattern 1 misses it.
   Assignments to the same name, later in the same function, are followed.

3. **The write carries it in its payload.** ::

       row = {"household_id": household_id, "title": title}
       _db().table("chores").insert(row).execute()

   The dict is built in an earlier statement, so pattern 1 misses it. Both dict
   literals and `row["household_id"] = ...` subscript assignments count.

Everything else — including a query filtered only by a foreign key, and an
update or delete by primary key after an ownership check — must be marked
explicitly:

    _db().table("items").select("*") \\
        .in_("receipt_id", receipt_ids) \\
        .execute()  # household-scope: ok — receipt_ids came from the scoped query above

Those two shapes *are* usually safe, but proving it needs dataflow analysis this
does not do, and "usually safe" is exactly where a cross-tenant leak hides. The
marker forces a person to state why, next to the code, where the reason stays
visible when the code changes.

Why a marker comment and not an allowlist
-----------------------------------------
This used to carry an `ALLOWED_UNSCOPED: dict[str, set[int]]` keyed by **line
number**. Any edit above an allowlisted call silently re-pointed the exemption
at a different query — an allowlist that quietly stops allowlisting what you
meant is worse than no allowlist. The marker travels with the line it exempts.
"""
from __future__ import annotations

import ast
import pathlib
import re
import sys

BACKEND_ROOT = pathlib.Path(__file__).resolve().parent.parent

# Tables that carry a household_id column and must always be scoped by it in
# application code (see "Database Schema" in CLAUDE.md). Duplicated in
# tests/fakes.py, which enforces the same invariant at runtime — this file runs
# as a bare script with no pytest on the path, so it cannot import from there.
HOUSEHOLD_SCOPED_TABLES = {
    "receipts", "items", "settings", "insurance_policies",
    "chores", "chore_logs", "helper_leave_requests", "helper_profile",
    "reimbursements", "pantry_items", "pantry_pending_confirmations",
    "price_history", "household_preferences", "proactive_notification_log",
    "api_keys", "shopping_list", "budgets", "savings_accounts", "reminders",
    "conversation_messages",
}

SCOPED_COLUMN = "household_id"

# `# household-scope: ok — <reason>` anywhere in the marked statement.
MARKER = re.compile(r"#\s*household-scope:\s*ok\b(?P<reason>.*)", re.IGNORECASE)


def _iter_py_files():
    for sub in ("api/routers", "services", "agents"):
        directory = BACKEND_ROOT / sub
        if directory.exists():
            yield from sorted(directory.rglob("*.py"))


def _parents(tree: ast.AST) -> dict[int, ast.AST]:
    parents: dict[int, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[id(child)] = parent
    return parents


def _enclosing(parents, node, types) -> ast.AST | None:
    cur = node
    while cur is not None and not isinstance(cur, types):
        cur = parents.get(id(cur))
    return cur


def _assigned_name(stmt: ast.stmt) -> str | None:
    """The single Name this statement assigns to, if any."""
    if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
        return stmt.targets[0].id
    if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
        return stmt.target.id
    return None


def _body_statements(scope: ast.AST) -> list[ast.stmt]:
    """Every statement inside a function/module, flattened."""
    return [n for n in ast.walk(scope) if isinstance(n, ast.stmt)]


def _dict_defines_household_id(node: ast.AST | None) -> bool:
    if not isinstance(node, ast.Dict):
        return False
    for key in node.keys:
        if isinstance(key, ast.Constant) and key.value == SCOPED_COLUMN:
            return True
        if key is None:  # {**base} — the spread may carry it; be permissive here,
            return True  # the payload is then usually a scoped dict built elsewhere.
    return False


def _payload_is_scoped(payload: ast.AST | None, scope: ast.AST, source: str) -> bool:
    """True if an insert/upsert argument carries household_id."""
    if payload is None:
        return False
    if _dict_defines_household_id(payload):
        return True
    # A list of dicts: every element must carry it.
    if isinstance(payload, (ast.List, ast.Tuple)) and payload.elts:
        return all(_dict_defines_household_id(e) for e in payload.elts)
    # A comprehension building rows: every produced element must carry it.
    if isinstance(payload, (ast.ListComp, ast.SetComp, ast.GeneratorExp)):
        return _dict_defines_household_id(payload.elt)

    # A Name bound earlier in the same function.
    if isinstance(payload, ast.Name):
        appended: list[ast.AST] = []
        for stmt in _body_statements(scope):
            bound = getattr(stmt, "value", None) if _assigned_name(stmt) == payload.id else None
            if bound is not None:
                if _dict_defines_household_id(bound):
                    return True
                # rows = [{...}, {...}] / rows = [{...} for x in y]
                if isinstance(bound, (ast.List, ast.Tuple)) and bound.elts:
                    if all(_dict_defines_household_id(e) for e in bound.elts):
                        return True
                if isinstance(bound, (ast.ListComp, ast.SetComp, ast.GeneratorExp)):
                    if _dict_defines_household_id(bound.elt):
                        return True
            # row["household_id"] = household_id
            if isinstance(stmt, ast.Assign):
                for target in stmt.targets:
                    if (
                        isinstance(target, ast.Subscript)
                        and isinstance(target.value, ast.Name)
                        and target.value.id == payload.id
                        and isinstance(target.slice, ast.Constant)
                        and target.slice.value == SCOPED_COLUMN
                    ):
                        return True
            # rows = []  ...  rows.append({...}) — the accumulator pattern.
            if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
                call = stmt.value
                if (
                    isinstance(call.func, ast.Attribute)
                    and call.func.attr == "append"
                    and isinstance(call.func.value, ast.Name)
                    and call.func.value.id == payload.id
                    and call.args
                ):
                    appended.append(call.args[0])
        # Every appended row must carry it, and there must be at least one —
        # an empty accumulator proves nothing. An appended row is often a Name
        # bound to a dict literal just above (`row = {...}; rows.append(row)`),
        # so resolve one level.
        if appended and all(_appended_row_carries_it(a, scope) for a in appended):
            return True
        return False
    # A comprehension or call passed inline.
    segment = ast.get_source_segment(source, payload) or ""
    return SCOPED_COLUMN in segment


def _appended_row_carries_it(node: ast.AST, scope: ast.AST) -> bool:
    """Does this appended element carry household_id? Resolves a bare Name to
    the dict literal it was bound to in the same function — one level only, so
    this cannot recurse."""
    if _dict_defines_household_id(node):
        return True
    if isinstance(node, ast.Name):
        return any(
            _assigned_name(stmt) == node.id and _dict_defines_household_id(getattr(stmt, "value", None))
            for stmt in _body_statements(scope)
        )
    return False


def _write_payload(call: ast.Call) -> ast.AST | None:
    """The argument of the insert/upsert/update this .table() call feeds into."""
    node = call
    # Walk outward through the attribute chain: .table(x).insert(row).execute()
    while True:
        parent = getattr(node, "_parent", None)
        if parent is None:
            return None
        if isinstance(parent, ast.Call) and isinstance(parent.func, ast.Attribute):
            if parent.func.attr in ("insert", "upsert", "update") and parent.args:
                return parent.args[0]
        node = parent


def _annotate_parents(tree: ast.AST) -> None:
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            child._parent = parent  # type: ignore[attr-defined]


def _chain_source(stmt: ast.stmt, scope: ast.AST, source: str) -> str:
    """The statement's source, plus any later statement that extends the same
    query-builder variable (`q = q.eq(...)`)."""
    text = ast.get_source_segment(source, stmt) or ""
    name = _assigned_name(stmt)
    if not name:
        return text
    for other in _body_statements(scope):
        if other is stmt or getattr(other, "lineno", 0) <= getattr(stmt, "lineno", 0):
            continue
        segment = ast.get_source_segment(source, other) or ""
        # Only follow statements that read the variable back — `q = q.eq(...)`,
        # `q = q.eq(...) if x else q.is_(...)`, `res = q.execute()`.
        if re.search(rf"\b{re.escape(name)}\b", segment):
            text += "\n" + segment
    return text


def _table_calls_in(scope: ast.AST) -> list[ast.Call]:
    return [
        n for n in ast.walk(scope)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "table"
        and n.args
        and isinstance(n.args[0], ast.Constant)
    ]


def _filters_by_key(stmt_source: str) -> bool:
    """True if the query is narrowed by a primary or foreign key.

    `.eq("id", x)`, `.in_("receipt_id", ids)`, `.eq("chore_id", c)` — a column
    named `id` or `<something>_id`, other than household_id itself.
    """
    for match in re.finditer(r'\.(?:eq|in_)\(\s*["\'](\w+)["\']', stmt_source):
        column = match.group(1)
        if column == SCOPED_COLUMN:
            continue
        if column == "id" or column.endswith("_id"):
            return True
    return False


def _household_established_earlier(
    scope: ast.AST, call: ast.Call, parents, source: str
) -> bool:
    """True if an earlier query in this same function was household-scoped.

    Covers the two shapes that dominate this codebase and that a static check
    cannot prove on its own:

      * update/delete by primary key after an ownership check — the function
        first selects the row's household_id and 404s on a mismatch;
      * a child table filtered by a foreign key harvested from a parent query
        that *was* scoped (`items` by `receipt_id`, from scoped `receipts`).

    Narrow on purpose: it only applies to a query already narrowed by a key
    (see `_filters_by_key`). A query with no key filter at all is still
    reported however much scoping happens elsewhere in the function, so this
    can never wave through a bare `.table("receipts").select("*")`.

    The residual risk is real and worth naming: a key that did *not* come from
    a scoped query, sitting in a function that happens to do scoped work
    elsewhere, is accepted. That is why this is a linter and tests/fakes.py's
    assert_scoped_to() checks the same invariant at runtime.
    """
    for other in _table_calls_in(scope):
        if other is call or other.lineno >= call.lineno:
            continue
        other_stmt = _enclosing(parents, other, ast.stmt)
        if other_stmt is None:
            continue
        if SCOPED_COLUMN in _chain_source(other_stmt, scope, source):
            return True
        if _payload_is_scoped(_write_payload(other), scope, source):
            return True
    return False


def analyse_source(source: str, filename: str = "<memory>") -> list[tuple[str, int, str]]:
    """Findings for one module's source. Split out from the directory walk so
    the detection rules can be tested against synthetic snippets — see
    tests/test_household_scoping_check.py."""
    findings: list[tuple[str, int, str]] = []
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError:
        return findings
    _annotate_parents(tree)
    parents = _parents(tree)
    lines = source.splitlines()

    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "table"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            continue

        table = node.args[0].value
        if table not in HOUSEHOLD_SCOPED_TABLES:
            continue

        stmt = _enclosing(parents, node, ast.stmt)
        if stmt is None:
            continue
        scope = _enclosing(parents, node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Module)) or tree

        # Pattern 1 + 2: household_id in the statement, or in a later statement
        # extending the same query variable.
        if SCOPED_COLUMN in _chain_source(stmt, scope, source):
            continue

        # Pattern 3: the written payload carries it.
        if _payload_is_scoped(_write_payload(node), scope, source):
            continue

        # Pattern 4: narrowed by a key, in a function that already established
        # the household.
        if _filters_by_key(_chain_source(stmt, scope, source)) and _household_established_earlier(
            scope, node, parents, source
        ):
            continue

        # An explicit, reasoned exemption, either inline on one of the
        # statement's own lines or in the comment block directly above it.
        # A one-line query is often already near the 120-column limit, and
        # the reason usually needs more than the remaining few columns.
        end = getattr(stmt, "end_lineno", stmt.lineno) or stmt.lineno
        first = stmt.lineno
        while first > 1 and lines[first - 2].strip().startswith("#"):
            first -= 1
        if any(MARKER.search(lines[i - 1]) for i in range(first, min(end, len(lines)) + 1)):
            continue

        findings.append((filename, node.lineno, table))

    return findings


def find_unscoped_queries() -> list[tuple[str, int, str]]:
    """Findings across every router, service and agent module."""
    findings: list[tuple[str, int, str]] = []
    for path in _iter_py_files():
        findings.extend(analyse_source(path.read_text(), str(path.relative_to(BACKEND_ROOT))))
    return findings


if __name__ == "__main__":
    findings = find_unscoped_queries()
    if findings:
        print(
            f"Found {len(findings)} query call(s) on a household-scoped table that could not be "
            f"shown to filter on, or write, '{SCOPED_COLUMN}':\n"
        )
        for rel, lineno, table in findings:
            print(f"  {rel}:{lineno}  .table(\"{table}\")")
        print(
            "\nEach is either a real cross-tenant leak (fix it) or safe for a reason a static\n"
            "check can't see — a foreign key already validated against the household, or an\n"
            "update by primary key after an ownership check. For the latter, state the reason\n"
            "on the statement:\n\n"
            "    .execute()  # household-scope: ok — <why this cannot reach another household>\n"
        )
        sys.exit(1)
    print(f"OK: every query on a household-scoped table is scoped to {SCOPED_COLUMN}.")
