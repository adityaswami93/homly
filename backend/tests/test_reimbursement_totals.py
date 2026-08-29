"""
services/reimbursement.compute_reimbursement_totals()/mark_receipts_reimbursed()
are the fix for the exact bug CLAUDE.md documents: paid status keyed by a
receipt's own `reimbursement_id` instead of an ISO-week ledger lookup, so a
caller-supplied date range that splits receipts across two ISO weeks can no
longer misattribute a payment. These pin down that a receipt's
`reimbursement_id` is the only thing that decides "already paid".
"""
from services.reimbursement import compute_reimbursement_totals, mark_receipts_reimbursed


def _receipt(total, reimbursable=True, reimbursement_id=None, date="2026-01-05"):
    return {"total": total, "reimbursable": reimbursable, "reimbursement_id": reimbursement_id, "date": date}


def test_totals_ignore_non_reimbursable_receipts():
    receipts = [_receipt(100.0, reimbursable=False)]
    assert compute_reimbursement_totals(receipts) == {
        "reimbursable_total": 0,
        "paid_reimbursable_total": 0,
        "outstanding_reimbursable_total": 0,
    }


def test_totals_split_paid_vs_outstanding_by_reimbursement_id():
    receipts = [
        _receipt(20.0, reimbursement_id="reim-1"),
        _receipt(30.0, reimbursement_id=None),
    ]
    result = compute_reimbursement_totals(receipts)
    assert result["paid_reimbursable_total"] == 20.0
    assert result["outstanding_reimbursable_total"] == 30.0
    assert result["reimbursable_total"] == 50.0


def test_totals_are_unaffected_by_which_iso_week_receipts_fall_in():
    # The bug this replaced: a payment recorded against one ISO week got
    # subtracted from receipts in a different, merely-overlapping view.
    # Paid status now depends only on reimbursement_id, not date/week, so
    # receipts spanning a week boundary total correctly together.
    receipts = [
        _receipt(10.0, reimbursement_id="reim-1", date="2026-01-04"),  # ISO week 1
        _receipt(15.0, reimbursement_id=None, date="2026-01-06"),      # ISO week 2
    ]
    result = compute_reimbursement_totals(receipts)
    assert result["paid_reimbursable_total"] == 10.0
    assert result["outstanding_reimbursable_total"] == 15.0


class _FakeQuery:
    def __init__(self, table):
        self.table = table

    def insert(self, row):
        self.table.inserted.append(row)
        return self

    def update(self, row):
        self.table.updated.append(row)
        return self

    def in_(self, col, ids):
        self._updated_ids = ids
        return self

    def eq(self, *_args):
        return self

    def execute(self):
        if self.table.inserted:
            row = {**self.table.inserted[-1], "id": "reimbursement-1"}
            return type("Res", (), {"data": [row]})()
        return type("Res", (), {"data": []})()


class _FakeTable:
    def __init__(self):
        self.inserted = []
        self.updated = []

    def table(self, _name):
        return _FakeQuery(self)


def test_mark_receipts_reimbursed_pays_off_only_unpaid_reimbursable_receipts():
    db = _FakeTable()
    receipts = [
        {"id": "r1", "total": 10.0, "reimbursable": True, "reimbursement_id": None, "date": "2026-01-04"},
        {"id": "r2", "total": 5.0, "reimbursable": True, "reimbursement_id": "already-paid", "date": "2026-01-05"},
        {"id": "r3", "total": 100.0, "reimbursable": False, "reimbursement_id": None, "date": "2026-01-06"},
    ]
    result = mark_receipts_reimbursed(db, "household-1", receipts, note="test payout")
    assert result["amount"] == 10.0
    assert result["receipt_ids"] == ["r1"]
    assert db.inserted[0]["household_id"] == "household-1"
    assert db.inserted[0]["amount"] == 10.0


def test_mark_receipts_reimbursed_returns_none_when_nothing_outstanding():
    db = _FakeTable()
    receipts = [
        {"id": "r1", "total": 10.0, "reimbursable": True, "reimbursement_id": "already-paid", "date": "2026-01-04"},
    ]
    assert mark_receipts_reimbursed(db, "household-1", receipts, note=None) is None
    assert db.inserted == []
