"""
Static guard for the multi-tenancy invariant documented in CLAUDE.md:

    "Most tables ... have ROW LEVEL SECURITY explicitly disabled ...
    household isolation is enforced entirely by application code
    remembering to scope every query. There is no database-level backstop."

This walks every router/service .py file, finds every Supabase
`.table("some_table")` call against a household-scoped table, and flags
any whose enclosing statement never mentions `household_id` anywhere in
the chain (select/eq/filter/etc). It's a heuristic, not a proof: it can't
see cross-statement query building, and a query that filters by a
household-scoped foreign key (e.g. `chore_id`, already validated
household-scoped earlier) will false-positive. Both should be reviewed
and either fixed or added to ALLOWED_UNSCOPED below with a one-line reason.
"""
from __future__ import annotations

import ast
import pathlib

BACKEND_ROOT = pathlib.Path(__file__).resolve().parent.parent

# Tables that carry a household_id column and must always be scoped by it
# in application code (see "Database Schema" in CLAUDE.md).
HOUSEHOLD_SCOPED_TABLES = {
    "receipts", "items", "settings", "insurance_policies",
    "chores", "chore_logs", "helper_leave_requests", "helper_profile",
    "reimbursements", "pantry_items", "pantry_pending_confirmations",
    "price_history", "household_preferences", "proactive_notification_log",
    "api_keys", "shopping_list", "budgets", "savings_accounts", "reminders",
    "conversation_messages",
}

# file -> set of line numbers (of the `.table(...)` call) that are known,
# reviewed exceptions, with the reason inline.
ALLOWED_UNSCOPED: dict[str, set[int]] = {
    # /internal/settings intentionally returns every household's settings
    # row for the WhatsApp bot's polling loop (see CLAUDE.md API Endpoints
    # > Internal); the admin routers intentionally query cross-household
    # for super-admin views. Populate exact (file, lineno) pairs here only
    # after confirming the call is genuinely meant to be unscoped.
}


def _iter_py_files():
    for sub in ("api/routers", "services", "agents"):
        d = BACKEND_ROOT / sub
        if d.exists():
            yield from d.rglob("*.py")


def _enclosing_statement(tree: ast.AST, node: ast.AST) -> ast.stmt:
    parents: dict[int, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[id(child)] = parent
    cur = node
    while not isinstance(cur, ast.stmt):
        cur = parents[id(cur)]
    return cur


def find_unscoped_queries() -> list[tuple[str, int, str]]:
    findings = []
    for path in _iter_py_files():
        source = path.read_text()
        try:
            tree = ast.parse(source, filename=str(path))
        except SyntaxError:
            continue

        table_calls = []
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "table"
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
            ):
                table_calls.append(node)

        for call in table_calls:
            table_name = call.args[0].value
            if table_name not in HOUSEHOLD_SCOPED_TABLES:
                continue

            rel = str(path.relative_to(BACKEND_ROOT))
            if call.lineno in ALLOWED_UNSCOPED.get(rel, set()):
                continue

            stmt = _enclosing_statement(tree, call)
            segment = ast.get_source_segment(source, stmt) or ""
            if "household_id" not in segment:
                findings.append((rel, call.lineno, table_name))

    return findings


if __name__ == "__main__":
    findings = find_unscoped_queries()
    if findings:
        print(f"Found {len(findings)} query call(s) on a household-scoped table with no "
              f"'household_id' anywhere in the enclosing statement:\n")
        for rel, lineno, table in findings:
            print(f"  {rel}:{lineno}  .table(\"{table}\")")
        print(
            "\nEach of these is either a real cross-tenant leak risk (fix it) or a "
            "reviewed exception (add its file:lineno to ALLOWED_UNSCOPED with a reason)."
        )
    else:
        print("OK: every household-scoped table query mentions household_id.")
