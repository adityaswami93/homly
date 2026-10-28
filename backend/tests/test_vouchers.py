"""services/vouchers.py — the voucher wallet's rules — and the chat agent on top.

Covers the rules that must be identical on the dashboard, in the WhatsApp
voucher_node, and in agents/query/vouchers_agent.py:

  * "expired" is derived from expires_at against the household's *local*
    today, never stored, and an expiry date is still usable on that day;
  * the same merchant + code (case-insensitive) or the same WhatsApp message
    is one voucher, not two;
  * a voucher with neither a code nor an image is not saved.

No DB or LLM: the Supabase client is a small in-memory fake.
"""
from datetime import date

import pytest

from services import vouchers

TODAY = date(2026, 10, 28)


class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, store, name):
        self.store, self.name = store, name
        self.filters, self.op, self.payload = [], "select", None

    def select(self, *a, **k):
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def update(self, patch):
        self.op, self.payload = "update", patch
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def _match(self, row):
        return all(row.get(c) == v for c, v in self.filters)

    def execute(self):
        rows = self.store.setdefault(self.name, [])
        if self.op == "insert":
            row = {"id": f"v{len(rows) + 1}", "created_at": "2026-10-28T00:00:00+00:00", **self.payload}
            rows.append(row)
            return _Res([row])
        hits = [r for r in rows if self._match(r)]
        if self.op == "update":
            for r in hits:
                r.update(self.payload)
        if self.op == "delete":
            self.store[self.name] = [r for r in rows if not self._match(r)]
        return _Res([dict(r) for r in hits])


class _Storage:
    def __init__(self):
        self.removed = []

    def from_(self, bucket):
        return self

    def remove(self, paths):
        self.removed.extend(paths)


class _DB:
    def __init__(self):
        self.store = {}
        self.storage = _Storage()

    def table(self, name):
        return _Query(self.store, name)


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    monkeypatch.setattr(vouchers, "_db", lambda: fake)
    monkeypatch.setattr(vouchers, "household_today", lambda hid: TODAY)
    return fake


# ── derived state ───────────────────────────────────────────────────────────


def test_expiry_day_itself_is_still_usable():
    assert vouchers.effective_status({"status": "active", "expires_at": "2026-10-28"}, TODAY) == "active"
    assert vouchers.effective_status({"status": "active", "expires_at": "2026-10-27"}, TODAY) == "expired"


def test_no_expiry_never_expires_and_used_stays_used():
    assert vouchers.effective_status({"status": "active", "expires_at": None}, TODAY) == "active"
    # Used beats expired: a used voucher's history shouldn't change once its date passes.
    assert vouchers.effective_status({"status": "used", "expires_at": "2020-01-01"}, TODAY) == "used"


def test_decorate_flags_expiring_soon_only_for_usable_vouchers():
    soon = vouchers.decorate({"status": "active", "expires_at": "2026-11-02"}, TODAY)
    assert soon["days_left"] == 5 and soon["expiring_soon"] is True
    later = vouchers.decorate({"status": "active", "expires_at": "2026-12-31"}, TODAY)
    assert later["expiring_soon"] is False
    expired = vouchers.decorate({"status": "active", "expires_at": "2026-10-01"}, TODAY)
    assert expired["effective_status"] == "expired" and expired["expiring_soon"] is False


def test_value_label():
    assert vouchers.value_label({"value_type": "percent", "value": 15}) == "15% off"
    assert vouchers.value_label({"value_type": "amount", "value": 10, "min_spend": 80}) == "$10 off (min spend 80)"
    assert vouchers.value_label({"value_type": "amount", "value": 5.5, "currency": "SGD"}) == "SGD 5.50 off"
    assert vouchers.value_label({"value_type": None}) is None


def test_normalize_coerces_llm_output():
    out = vouchers.normalize({
        "merchant": " FairPrice ", "code": " SAVE  10 ", "kind": "coupon",
        "value": "$1,000", "currency": "sgd", "expires_at": "2026-11-30T00:00:00",
    })
    assert out["merchant"] == "FairPrice"
    assert out["code"] == "SAVE 10"
    assert out["kind"] == "promo_code"     # unknown kind falls back, by whether there's a code
    assert out["value"] == 1000.0
    assert out["currency"] == "SGD"
    assert out["expires_at"] == "2026-11-30"


def test_describe_mentions_code_and_countdown():
    row = vouchers.decorate({"merchant": "Grab", "code": "RIDE5", "value_type": "amount", "value": 5,
                             "expires_at": "2026-10-29", "status": "active"}, TODAY)
    line = vouchers.describe(row)
    assert "*Grab*" in line and "`RIDE5`" in line and "tomorrow" in line


# ── create_voucher ──────────────────────────────────────────────────────────


def test_create_then_same_code_different_case_is_a_duplicate(db):
    row, created, err = vouchers.create_voucher("hh", {"merchant": "Lazada", "code": "SAVE20"})
    assert created and err is None and row["effective_status"] == "active"

    again, created2, err2 = vouchers.create_voucher("hh", {"merchant": "lazada", "code": "save20"})
    assert created2 is False and err2 is None and again["id"] == row["id"]
    assert len(db.store["vouchers"]) == 1


def test_same_code_in_another_household_is_not_a_duplicate(db):
    vouchers.create_voucher("hh-a", {"merchant": "Lazada", "code": "SAVE20"})
    _, created, _ = vouchers.create_voucher("hh-b", {"merchant": "Lazada", "code": "SAVE20"})
    assert created is True


def test_whatsapp_redelivery_of_a_codeless_voucher_is_a_duplicate(db):
    first, created, _ = vouchers.create_voucher(
        "hh", {"merchant": "Starbucks"}, image_path="hh/a.jpg", whatsapp_message_id="WA1")
    assert created
    again, created2, _ = vouchers.create_voucher(
        "hh", {"merchant": "Starbucks"}, image_path="hh/b.jpg", whatsapp_message_id="WA1")
    assert created2 is False and again["id"] == first["id"]


def test_rejects_voucher_without_merchant_or_without_code_and_image(db):
    assert vouchers.create_voucher("hh", {"code": "X1"})[2]
    assert vouchers.create_voucher("hh", {"merchant": "Shopee"})[2]
    assert "vouchers" not in db.store or not db.store["vouchers"]


def test_list_history_and_wallet_split(db):
    vouchers.create_voucher("hh", {"merchant": "A", "code": "A1", "expires_at": "2026-12-01"})
    vouchers.create_voucher("hh", {"merchant": "B", "code": "B1", "expires_at": "2026-10-01"})
    used, _, _ = vouchers.create_voucher("hh", {"merchant": "C", "code": "C1"})
    vouchers.mark_used("hh", used["id"], "Aditya")

    assert [r["merchant"] for r in vouchers.list_vouchers("hh", "active")] == ["A"]
    assert {r["merchant"] for r in vouchers.list_vouchers("hh", "history")} == {"B", "C"}
    assert [r["merchant"] for r in vouchers.find_vouchers("hh", merchant="a")] == ["A"]


# ── chat agent ──────────────────────────────────────────────────────────────


def test_agent_mark_used_asks_when_ambiguous(db):
    from agents.query.vouchers_agent import VouchersQueryAgent

    vouchers.create_voucher("hh", {"merchant": "FairPrice", "code": "FP10"})
    vouchers.create_voucher("hh", {"merchant": "FairPrice", "code": "FP20"})
    agent = VouchersQueryAgent()

    res = agent.handle("mark_used", {"merchant": "FairPrice"}, "hh")
    assert res.handled is False and "which one" in res.natural_language

    res = agent.handle("mark_used", {"code": "fp20"}, "hh", sender_name="Bhavya")
    assert res.handled is True
    assert [r["code"] for r in vouchers.list_vouchers("hh", "active")] == ["FP10"]


def test_agent_add_voucher_prefers_explicit_fields_over_reextraction(db, monkeypatch):
    import agents.query.vouchers_agent as va

    monkeypatch.setattr(va, "household_today", lambda hid: TODAY)
    monkeypatch.setattr(va, "extract_from_text", lambda text, today=None: {
        "is_voucher": True, "merchant": "Lazada", "code": "SAVE2O", "value_type": "percent",
        "value": 20, "expires_at": "2026-11-30", "confidence": "medium",
    })
    res = va.VouchersQueryAgent().handle(
        "add_voucher", {"text": "use SAVE20 for 20% off Lazada till 30 Nov", "code": "SAVE20"}, "hh")
    assert res.handled
    saved = db.store["vouchers"][0]
    assert saved["code"] == "SAVE20" and saved["expires_at"] == "2026-11-30"
