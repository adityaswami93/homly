"""The shared test double has to be trustworthy before anything is asserted through it.

`assert_scoped_to()` is the runtime half of the multi-tenancy guard, and a
version of it that quietly returns "no offenders" for every input would make
every future tenancy test pass without testing anything. So it gets a test that
it actually *fails* on a leak, not just one that it passes on clean code.
"""
from tests.fakes import FakeSupabase, assert_scoped_to, unscoped_calls


# ── query builder behaves enough like postgrest ─────────────────────────────


def test_eq_filters_rather_than_returning_every_seeded_row():
    db = FakeSupabase({"receipts": [
        {"id": "r1", "household_id": "hh-1", "total": 10},
        {"id": "r2", "household_id": "hh-2", "total": 20},
    ]})
    rows = db.table("receipts").select("*").eq("household_id", "hh-1").execute().data
    assert [r["id"] for r in rows] == ["r1"]


def test_insert_returns_the_written_row_and_makes_it_readable():
    db = FakeSupabase()
    written = db.table("chores").insert({"household_id": "hh-1", "title": "mop"}).execute().data
    assert written[0]["title"] == "mop"
    assert written[0]["id"], "an inserted row needs an id, like postgrest returns"

    assert db.table("chores").select("*").eq("household_id", "hh-1").execute().data == written


def test_update_touches_only_matching_rows():
    db = FakeSupabase({"receipts": [
        {"id": "r1", "household_id": "hh-1", "flagged": False},
        {"id": "r2", "household_id": "hh-1", "flagged": False},
    ]})
    db.table("receipts").update({"flagged": True}).eq("id", "r1").execute()

    rows = {r["id"]: r["flagged"] for r in db.rows["receipts"]}
    assert rows == {"r1": True, "r2": False}


def test_is_null_matches_missing_values_not_present_ones():
    db = FakeSupabase({"receipts": [
        {"id": "r1", "reimbursement_id": None},
        {"id": "r2", "reimbursement_id": "paid-1"},
    ]})
    # postgrest spells NULL as the string "null" — services/preferences.py
    # relies on this exact call shape.
    rows = db.table("receipts").select("*").is_("reimbursement_id", "null").execute().data
    assert [r["id"] for r in rows] == ["r1"]


def test_order_desc_and_limit():
    db = FakeSupabase({"conversation_messages": [
        {"id": "m1", "created_at": "2026-01-01"},
        {"id": "m3", "created_at": "2026-01-03"},
        {"id": "m2", "created_at": "2026-01-02"},
    ]})
    rows = (
        db.table("conversation_messages").select("*")
        .order("created_at", desc=True).limit(2).execute().data
    )
    assert [r["id"] for r in rows] == ["m3", "m2"]


def test_single_returns_a_row_not_a_list_and_none_when_empty():
    db = FakeSupabase({"settings": [{"id": "s1", "household_id": "hh-1"}]})
    assert db.table("settings").select("*").eq("household_id", "hh-1").single().execute().data["id"] == "s1"
    assert db.table("settings").select("*").eq("household_id", "nope").single().execute().data is None


# ── call recording ──────────────────────────────────────────────────────────


def test_filters_are_recorded_for_assertion():
    db = FakeSupabase()
    db.table("items").select("*").eq("household_id", "hh-1").gte("receipt_date", "2026-01-01").execute()
    assert db.filters("items") == [
        ("eq", "household_id", "hh-1"),
        ("gte", "receipt_date", "2026-01-01"),
    ]


# ── the tenancy guard ───────────────────────────────────────────────────────


def test_scoped_read_is_not_flagged():
    db = FakeSupabase()
    db.table("receipts").select("*").eq("household_id", "hh-1").execute()
    assert unscoped_calls(db, "hh-1") == []


def test_unscoped_read_on_a_shared_table_is_flagged():
    db = FakeSupabase()
    db.table("receipts").select("*").eq("flagged", True).execute()
    assert len(unscoped_calls(db, "hh-1")) == 1


def test_a_query_scoped_to_someone_elses_household_is_flagged():
    # The failure that matters most: not "no filter" but "the wrong filter".
    db = FakeSupabase()
    db.table("receipts").select("*").eq("household_id", "hh-2").execute()
    assert len(unscoped_calls(db, "hh-1")) == 1


def test_a_write_carrying_household_id_in_its_payload_counts_as_scoped():
    # The dominant safe pattern in this codebase: insert a dict that was built
    # with household_id, without also filtering on it.
    db = FakeSupabase()
    db.table("chores").insert({"household_id": "hh-1", "title": "mop"}).execute()
    assert unscoped_calls(db, "hh-1") == []


def test_unscoped_query_on_an_unshared_table_is_ignored():
    # households/invites/auth.users carry no household_id column of their own.
    db = FakeSupabase()
    db.table("households").select("*").eq("id", "hh-1").execute()
    assert unscoped_calls(db, "hh-1") == []


def test_assert_scoped_to_raises_and_names_the_offending_table():
    db = FakeSupabase()
    db.table("items").select("*").execute()
    try:
        assert_scoped_to(db, "hh-1")
    except AssertionError as exc:
        assert "items" in str(exc)
    else:
        raise AssertionError("assert_scoped_to must fail on an unscoped query")
