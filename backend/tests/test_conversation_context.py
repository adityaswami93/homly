"""Short-term memory: services/conversation.py plus the two places
agents/homly_graph.py's classify_node reads it.

Bug this covers: the WhatsApp entry point hard-coded run_query()'s `context`
to `[]` and nothing ever wrote a turn down, so every message was reasoned
about in isolation — the assistant answered a reply to its own message with
"that's a big reaction for no context", and couldn't resolve a follow-up like
"how much then?". No DB and no LLM call is made here; the Supabase client and
services.llm_client are monkeypatched.
"""
from datetime import datetime, timedelta, timezone as tz

import agents.homly_graph as hg
from services import conversation


def _ts(minutes_ago: float) -> str:
    return (datetime.now(tz.utc) - timedelta(minutes=minutes_ago)).isoformat()


def _entry(role: str, content: str, minutes_ago: float = 1, sender_name: str | None = None) -> dict:
    return {"role": role, "content": content, "sender_name": sender_name, "created_at": _ts(minutes_ago)}


# ── is_awaiting_reply: the follow-up addressing signal ──────────────────────


def test_awaiting_reply_when_bot_spoke_last_and_recently():
    context = [_entry("user", "Aditya: how much on groceries?", 3), _entry("assistant", "SGD 82 so far.", 1)]
    assert conversation.is_awaiting_reply(context) is True


def test_not_awaiting_reply_when_a_member_spoke_after_the_bot():
    context = [_entry("assistant", "SGD 82 so far.", 5), _entry("user", "Bhavya: ok cool", 1)]
    assert conversation.is_awaiting_reply(context) is False


def test_not_awaiting_reply_once_the_window_has_passed():
    context = [_entry("assistant", "SGD 82 so far.", 90)]
    assert conversation.is_awaiting_reply(context, window_minutes=10) is False


def test_not_awaiting_reply_on_empty_or_untimestamped_context():
    assert conversation.is_awaiting_reply([]) is False
    # /query callers pass their own context, which carries no timestamps.
    assert conversation.is_awaiting_reply([{"role": "assistant", "content": "hi"}]) is False


# ── get_context: shape handed to the supervisor ────────────────────────────


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *a, **k):  return self
    def eq(self, *a, **k):      return self
    def gte(self, *a, **k):     return self
    def order(self, *a, **k):   return self
    def limit(self, *a, **k):   return self

    def execute(self):
        return type("Res", (), {"data": self._rows})()


def _fake_db(rows):
    return type("DB", (), {"table": staticmethod(lambda name: _FakeQuery(rows))})()


def test_get_context_is_oldest_first_and_labels_the_speaker(monkeypatch):
    # Supabase returns newest-first (order desc); the prompt needs oldest-first.
    rows = [
        {"role": "assistant", "content": "SGD 82 so far.", "sender_name": None, "created_at": _ts(1)},
        {"role": "user", "content": "how much on groceries?", "sender_name": "Aditya", "created_at": _ts(3)},
    ]
    monkeypatch.setattr(conversation, "_db", lambda: _fake_db(rows))

    context = conversation.get_context("hh-1", "123@g.us")

    assert [c["role"] for c in context] == ["user", "assistant"]
    # A group has more than two speakers, so who said it is part of the message.
    assert context[0]["content"] == "Aditya: how much on groceries?"
    assert context[1]["content"] == "SGD 82 so far."


def test_get_context_without_a_group_makes_no_db_call(monkeypatch):
    def _boom():
        raise AssertionError("should not query without a group_jid")

    monkeypatch.setattr(conversation, "_db", _boom)
    assert conversation.get_context("hh-1", None) == []


def test_get_context_returns_empty_when_the_lookup_fails(monkeypatch):
    def _raising_db():
        raise RuntimeError("supabase down")

    monkeypatch.setattr(conversation, "_db", _raising_db)
    # Degrades to "no memory" — never to a failed message.
    assert conversation.get_context("hh-1", "123@g.us") == []


# ── classify_node: context reaches both decisions ──────────────────────────


def _text_state(**overrides) -> dict:
    state = {
        "household_id": "",  # bot_profile.get_profile("") -> DEFAULT_PROFILE, no DB call
        "group_jid": "123@g.us",
        "query": "😮",
        "image_bytes": None,
        "was_mentioned": False,
        "is_reply_to_bot": False,
        "context": [],
    }
    state.update(overrides)
    return state


def test_reply_to_the_bots_own_last_message_counts_as_addressed(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_completion", lambda *a, **k: '{"type": "unknown"}')

    # 'mentioned' is the strictest mode — without the follow-up signal this
    # reaction to the bot's own message would be silently dropped.
    monkeypatch.setattr(
        hg.bot_profile, "get_profile",
        lambda hid: hg.bot_profile.BotProfile(engagement_mode="mentioned"),
    )

    result = hg.classify_node(_text_state(context=[_entry("assistant", "Your car policy renews 10 Sept.", 1)]))

    assert result["addressed"] is True
    assert result["engage"] is True


def test_unaddressed_chatter_after_a_member_spoke_is_still_ignored(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_completion", lambda *a, **k: '{"type": "unknown"}')
    monkeypatch.setattr(
        hg.bot_profile, "get_profile",
        lambda hid: hg.bot_profile.BotProfile(engagement_mode="mentioned"),
    )

    context = [_entry("assistant", "Your car policy renews 10 Sept.", 20), _entry("user", "Bhavya: nice", 2)]
    result = hg.classify_node(_text_state(query="lol", context=context))

    assert result["addressed"] is False
    assert result["engage"] is False


def test_classifier_is_given_the_recent_conversation(monkeypatch):
    seen = {}

    import services.llm_client as llm_client

    def _capture(prompt, **kwargs):
        seen["prompt"] = prompt
        return '{"type": "text_query"}'

    monkeypatch.setattr(llm_client, "get_completion", _capture)

    context = [_entry("user", "Aditya: how much on groceries?", 3), _entry("assistant", "SGD 82 so far.", 1)]
    assert hg._classify_text("and last month?", context) == "text_query"
    assert "SGD 82 so far." in seen["prompt"]
    assert "and last month?" in seen["prompt"]


def test_classifier_prompt_has_no_transcript_section_without_context(monkeypatch):
    seen = {}

    import services.llm_client as llm_client

    def _capture(prompt, **kwargs):
        seen["prompt"] = prompt
        return '{"type": "text_query"}'

    monkeypatch.setattr(llm_client, "get_completion", _capture)

    assert hg._classify_text("how much did we spend?", []) == "text_query"
    assert "Recent conversation" not in seen["prompt"]


def test_keyword_fallback_still_works_when_the_model_fails(monkeypatch):
    import services.llm_client as llm_client

    def _raise(*a, **k):
        raise TimeoutError("model call timed out")

    monkeypatch.setattr(llm_client, "get_completion", _raise)
    context = [_entry("assistant", "SGD 82 so far.", 1)]
    assert hg._classify_text("what did we spend on transport?", context) == "text_query"
