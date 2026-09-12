"""The multi-tenancy linter is only worth blocking CI on if it actually fires.

CLAUDE.md: RLS is disabled on every shared table, so application code is the
only thing preventing one household reading or writing another's data. This
check is the mechanical half of that guarantee, so it needs its own tests in
both directions — that it catches an unscoped query, and that it does not cry
wolf on the four safe shapes this codebase uses. A linter that only ever passes
gets trusted and shouldn't be; one that cries wolf gets an ever-growing
exemption list and stops meaning anything.

Two things worth knowing about the version this replaced:

  * its allowlist was keyed by **line number**, so an edit above an exempted
    call silently moved the exemption onto a different query;
  * `__main__` never called `sys.exit`, so the CI step reported ✅ while
    printing 51 findings into its own log.
"""
import textwrap

from tests.check_household_scoping import analyse_source


def findings(src: str):
    return analyse_source(textwrap.dedent(src), "example.py")


# ── it catches real leaks ───────────────────────────────────────────────────


def test_a_bare_select_on_a_shared_table_is_reported():
    assert findings("""
        def list_receipts(db):
            return db.table("receipts").select("*").execute()
    """)


def test_a_query_filtered_by_something_other_than_household_is_reported():
    assert findings("""
        def flagged(db):
            return db.table("receipts").select("*").eq("flagged", True).execute()
    """)


def test_an_insert_without_household_id_in_its_payload_is_reported():
    assert findings("""
        def add(db, title):
            db.table("chores").insert({"title": title}).execute()
    """)


def test_an_accumulator_where_only_some_rows_carry_it_is_reported():
    # The dangerous half-migration: one branch scoped, another not.
    assert findings("""
        def add_many(db, household_id, items):
            rows = []
            for item in items:
                rows.append({"household_id": household_id, "name": item})
            for extra in items:
                rows.append({"name": extra})
            db.table("items").insert(rows).execute()
    """)


def test_a_key_filtered_query_with_no_earlier_scoped_query_is_reported():
    # Pattern 4 must not fire just because the query looks like a lookup by id.
    assert findings("""
        def get_receipt(db, receipt_id):
            return db.table("receipts").select("*").eq("id", receipt_id).execute()
    """)


def test_an_unfiltered_query_is_reported_even_in_a_function_that_scopes_elsewhere():
    # The deliberate limit on pattern 4: scoping one query does not license the
    # next one to read everything.
    assert findings("""
        def report(db, household_id):
            db.table("receipts").select("*").eq("household_id", household_id).execute()
            return db.table("items").select("*").execute()
    """)


# ── it stays quiet on the safe shapes ───────────────────────────────────────


def test_a_directly_scoped_query_is_clean():
    assert not findings("""
        def list_receipts(db, household_id):
            return db.table("receipts").select("*").eq("household_id", household_id).execute()
    """)


def test_a_chain_built_across_statements_is_clean():
    assert not findings("""
        def search(db, household_id, vendor):
            q = db.table("receipts").select("*")
            q = q.eq("household_id", household_id)
            if vendor:
                q = q.eq("vendor", vendor)
            return q.execute()
    """)


def test_an_insert_of_a_dict_built_earlier_is_clean():
    assert not findings("""
        def add(db, household_id, title):
            row = {"household_id": household_id, "title": title}
            db.table("chores").insert(row).execute()
    """)


def test_a_subscript_assignment_of_household_id_is_clean():
    assert not findings("""
        def add(db, household_id, data):
            data["household_id"] = household_id
            db.table("savings_accounts").insert(data).execute()
    """)


def test_a_list_comprehension_payload_is_clean():
    assert not findings("""
        def add_items(db, household_id, receipt_id, items):
            rows = [
                {"household_id": household_id, "receipt_id": receipt_id, "name": i["name"]}
                for i in items
            ]
            db.table("items").insert(rows).execute()
    """)


def test_an_append_accumulator_of_scoped_rows_is_clean():
    assert not findings("""
        def add_many(db, household_id, items):
            rows = []
            for item in items:
                row = {"household_id": household_id, "name": item}
                rows.append(row)
            db.table("items").insert(rows).execute()
    """)


def test_a_foreign_key_query_after_a_scoped_parent_query_is_clean():
    # `items` by receipt_id, where the receipts came from a scoped query.
    assert not findings("""
        def week(db, household_id):
            receipts = db.table("receipts").select("id").eq("household_id", household_id).execute()
            receipt_ids = [r["id"] for r in receipts.data]
            return db.table("items").select("*").in_("receipt_id", receipt_ids).execute()
    """)


def test_an_update_by_id_after_an_ownership_check_is_clean():
    assert not findings("""
        def soft_delete(db, household_id, receipt_id):
            existing = db.table("receipts").select("household_id").eq("id", receipt_id).execute()
            if existing.data[0]["household_id"] != household_id:
                raise ValueError("not found")
            db.table("receipts").update({"deleted": True}).eq("id", receipt_id).execute()
    """)


def test_a_table_that_carries_no_household_id_column_is_ignored():
    assert not findings("""
        def households(db):
            return db.table("households").select("*").execute()
    """)


# ── the exemption marker ────────────────────────────────────────────────────


def test_an_inline_marker_exempts_the_statement():
    assert not findings("""
        def everything(db):
            return db.table("price_history").select("*").execute()  # household-scope: ok — super admin
    """)


def test_a_marker_in_the_comment_block_above_exempts_the_statement():
    # Markers usually need more room than the line has left, so a preceding
    # comment block counts — including when the reason runs to several lines.
    assert not findings("""
        def everything(db):
            # household-scope: ok — cross-household by design, super-admin only.
            # Returns aggregates rather than rows.
            return db.table("price_history").select("*").execute()
    """)


def test_an_unrelated_comment_above_does_not_exempt_anything():
    assert findings("""
        def everything(db):
            # Fetch all the price history.
            return db.table("price_history").select("*").execute()
    """)


def test_the_marker_does_not_leak_to_the_next_statement():
    # A marker exempts its own statement only — otherwise one annotation
    # silently covers everything written after it.
    result = findings("""
        def two_queries(db):
            db.table("price_history").select("*").execute()  # household-scope: ok — reviewed
            db.table("receipts").select("*").execute()
    """)
    assert [table for _f, _l, table in result] == ["receipts"]


# ── the repository itself ───────────────────────────────────────────────────


def test_the_backend_has_no_unscoped_queries():
    """The check CI runs, as a test, so a regression fails the suite and not
    only the separate scanner step."""
    from tests.check_household_scoping import find_unscoped_queries

    found = find_unscoped_queries()
    assert not found, "unscoped queries:\n" + "\n".join(f"  {f}:{ln}  {t}" for f, ln, t in found)
