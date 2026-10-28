"""Photos the assistant reads, asks about, and remembers.

Behaviour this covers (agents/homly_graph.py, agents/document_reader.py,
services/documents.py, agents/proactive_agent.py):

  * an engaged unrecognised photo is read, stored, and answered with what it
    is plus numbered options — not the old fixed "I can't tell what this is";
  * an UNengaged one is never read or stored (privacy: family photos);
  * a WhatsApp redelivery isn't read or announced twice;
  * a voucher photo (vision or caption) is saved straight to the wallet, and
    one that turns out not to be a voucher falls back to the engagement gate;
  * reminders can now be created from chat — and the unattended proactive
    loop still can't create one, or write vouchers/documents.

No DB or LLM calls: services and llm_client are monkeypatched.
"""
import json
from dataclasses import replace
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest

import agents.homly_graph as hg
from services import bot_profile

READING = {
    "doc_type": "letter",
    "title": "Science Centre excursion letter",
    "summary": "P4 trip to the Science Centre on 14 Nov. $12 fee due by 7 Nov.",
    "extracted_text": "Dear parents, ... fee of $12 ... by 7 November ...",
    "key_facts": [{"label": "Trip date", "value": "2026-11-14"}, {"label": "Fee", "value": "$12"}],
    "suggested_actions": [{"label": "Remind us to pay the $12 fee on 6 Nov"}],
}


def _state(**overrides) -> dict:
    state = {
        "household_id": "",  # DEFAULT_PROFILE, no DB call
        "group_jid": "123@g.us",
        "query": None,
        "image_bytes": b"img",
        "image_mime": "image/jpeg",
        "was_mentioned": False,
        "is_reply_to_bot": False,
        "whatsapp_message_id": "WA1",
        "sender_name": "Aditya",
        "sender_phone": "6591234567",
    }
    state.update(overrides)
    return state


@pytest.fixture
def docs(monkeypatch):
    """Fake services.documents + household_today; returns the saved calls."""
    from services import documents, household_time

    saved = []
    monkeypatch.setattr(household_time, "household_today", lambda hid: date(2026, 10, 28))
    monkeypatch.setattr(documents, "get_by_whatsapp_id", lambda hid, wa: None)
    monkeypatch.setattr(documents, "upload_image", lambda *a, **k: "hh/img.jpg")

    def _save(household_id, reading, **kw):
        saved.append({"reading": reading, **kw})
        return {"id": "doc-1", **reading}

    monkeypatch.setattr(documents, "save_document", _save)
    return saved


def _reader_returns(monkeypatch, reading):
    import agents.document_reader as dr
    monkeypatch.setattr(dr, "read_image", lambda *a, **k: reading)


# ── read_image_node ─────────────────────────────────────────────────────────


def test_read_image_node_stores_and_asks(monkeypatch, docs):
    _reader_returns(monkeypatch, READING)
    out = hg.read_image_node(_state(query="what is this?"))

    assert docs and docs[0]["caption"] == "what is this?" and docs[0]["image_path"] == "hh/img.jpg"
    reply = out["response"]
    assert "*Science Centre excursion letter*" in reply
    assert "• Fee: $12" in reply
    assert "1. Remind us to pay the $12 fee on 6 Nov" in reply
    assert "2. Nothing for now" in reply
    # It's recorded as the assistant's turn, so it must fit the transcript's cap.
    from services.conversation import _MAX_CONTENT_CHARS
    assert len(reply) <= _MAX_CONTENT_CHARS


def test_read_image_node_falls_back_honestly_when_unreadable(monkeypatch, docs):
    _reader_returns(monkeypatch, {"error": "timeout"})
    out = hg.read_image_node(_state())
    assert out["response"] == hg.unsupported_image_node({})["response"]
    assert docs == []


def test_read_image_node_skips_a_redelivered_photo(monkeypatch, docs):
    from services import documents
    monkeypatch.setattr(documents, "get_by_whatsapp_id", lambda hid, wa: {"id": "doc-1"})

    def _boom(*a, **k):
        raise AssertionError("must not re-read a redelivered photo")

    monkeypatch.setattr("agents.document_reader.read_image", _boom)
    assert hg.read_image_node(_state())["response"] is None


def test_read_image_node_says_so_when_it_could_not_store(monkeypatch, docs):
    from services import documents
    _reader_returns(monkeypatch, READING)
    monkeypatch.setattr(documents, "save_document", lambda *a, **k: None)
    assert "couldn't save it" in hg.read_image_node(_state())["response"]


def test_graph_reads_an_engaged_photo_but_never_an_unengaged_one(monkeypatch, docs):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_vision_completion", lambda *a, **k: json.dumps({"type": "other_image"}))
    _reader_returns(monkeypatch, READING)

    silent = hg.graph.invoke(_state())                       # smart mode, not addressed
    assert silent.get("response") is None and docs == []

    answered = hg.graph.invoke(_state(was_mentioned=True))
    assert "excursion" in answered["response"] and len(docs) == 1


# ── document_reader ─────────────────────────────────────────────────────────


def test_reader_normalizes_and_rejects_empty_readings(monkeypatch):
    import agents.document_reader as dr

    monkeypatch.setattr(dr, "get_vision_completion", lambda *a, **k: json.dumps({
        "doc_type": "spaceship", "title": "Bill", "summary": "Electricity bill",
        "key_facts": [{"label": "Due", "value": "2026-11-05"}, {"label": "empty", "value": ""}, "junk"],
        "suggested_actions": ["Remind us", {"label": "Save it"}, {"label": ""}, {"label": "a"}, {"label": "b"}],
    }))
    r = dr.read_image(b"x")
    assert r["doc_type"] == "other"
    assert r["key_facts"] == [{"label": "Due", "value": "2026-11-05"}]
    assert [a["label"] for a in r["suggested_actions"]] == ["Remind us", "Save it", "a"]

    monkeypatch.setattr(dr, "get_vision_completion", lambda *a, **k: '{"title": "x"}')
    assert "error" in dr.read_image(b"x")


def test_capabilities_offered_to_the_reader_include_vouchers_and_reminders():
    from agents.orchestrator.registry import describe_capabilities
    text = describe_capabilities()
    assert "reminder" in text and "voucher" in text and "just keep it" in text


# ── voucher photos ──────────────────────────────────────────────────────────


def test_voucher_caption_wins_over_the_vision_classifier(monkeypatch):
    import services.llm_client as llm_client

    def _boom(*a, **k):
        raise AssertionError("caption should decide before any vision call")

    monkeypatch.setattr(llm_client, "get_vision_completion", _boom)
    result = hg.classify_node(_state(query="save this voucher pls"))
    assert result["message_type"] == "voucher"
    assert result["engage"] is True     # an explicit action, like a receipt


def test_vision_voucher_type_maps_to_voucher(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_vision_completion", lambda *a, **k: json.dumps({"type": "voucher"}))
    result = hg.classify_node(_state())
    assert result["message_type"] == "voucher" and result["engage"] is True
    assert hg.route_by_type(result) == "voucher"


def test_voucher_node_saves_to_wallet(monkeypatch, docs):
    from services import vouchers
    import agents.voucher_agent as va

    monkeypatch.setattr(va, "extract_from_image", lambda *a, **k: {
        "is_voucher": True, "merchant": "FairPrice", "code": "FP10", "value_type": "amount",
        "value": 10, "expires_at": "2026-11-30", "confidence": "low",
    })
    calls = {}

    def _create(household_id, data, **kw):
        calls.update(kw)
        return vouchers.decorate({**vouchers.normalize(data), "status": "active", "confidence": "low"},
                                 date(2026, 10, 28)), True, None

    monkeypatch.setattr(vouchers, "create_voucher", _create)
    out = hg.voucher_node(_state())
    assert "Saved to the voucher wallet" in out["response"] and "`FP10`" in out["response"]
    assert "double-check" in out["response"]
    assert calls["source"] == "whatsapp" and calls["whatsapp_message_id"] == "WA1"


def test_voucher_node_not_a_voucher_after_all_respects_engagement(monkeypatch, docs):
    import agents.voucher_agent as va
    monkeypatch.setattr(va, "extract_from_image", lambda *a, **k: {"is_voucher": False})
    _reader_returns(monkeypatch, READING)

    # Not addressed, smart mode: an ordinary photo stays unread.
    assert hg.voucher_node(_state(addressed=False))["response"] is None
    assert docs == []
    # Addressed: read and ask like any other photo.
    assert "excursion" in hg.voucher_node(_state(addressed=True))["response"]

    monkeypatch.setattr(bot_profile, "get_profile",
                        lambda hid: replace(bot_profile.DEFAULT_PROFILE, engagement_mode="always"))
    assert hg.voucher_node(_state(addressed=False))["response"]


# ── documents retention ─────────────────────────────────────────────────────


def test_every_document_gets_its_own_expiry_from_the_code_setting():
    from services import documents
    created = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert (documents.expiry_for(created) - created).days == documents.RETENTION_DAYS


# ── reminders from chat ─────────────────────────────────────────────────────


def test_parse_local_datetime_reads_household_local_time():
    from agents.query.reminders_agent import parse_local_datetime
    sgt = ZoneInfo("Asia/Singapore")
    assert parse_local_datetime("2026-11-06T18:30", sgt) == datetime(2026, 11, 6, 10, 30, tzinfo=timezone.utc)
    # A bare date means 9am local.
    assert parse_local_datetime("2026-11-06", sgt) == datetime(2026, 11, 6, 1, 0, tzinfo=timezone.utc)
    assert parse_local_datetime("next tuesday", sgt) is None


def test_proactive_loop_cannot_write_reminders_vouchers_or_documents():
    from agents.proactive_agent import _READONLY_INTENTS
    assert "create_reminder" not in (_READONLY_INTENTS["query_reminders"] or set())
    assert _READONLY_INTENTS["query_reminders"] is not None
    assert not {"add_voucher", "save_from_document", "mark_used"} & _READONLY_INTENTS["query_vouchers"]
    assert "forget" not in _READONLY_INTENTS["query_documents"]
