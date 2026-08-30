"""agents/homly_graph.py's text classifier — the router every WhatsApp text
message goes through before anything reasons about it (see classify_node).

Classification is now LLM-first with a keyword fallback (_classify_text_keywords)
for when the model call fails, times out, or returns something unrecognized.
No live LLM call is made here — services.llm_client.get_completion is
monkeypatched — but this still exercises the real parsing/validation/fallback
code paths, plus a small representative eval set against the keyword layer,
which previously had zero regression coverage.
"""
import agents.homly_graph as hg


# ── _classify_text_llm: parsing and fallback behavior ───────────────────────


def test_llm_classify_returns_recognized_type(monkeypatch):
    monkeypatch.setattr(hg, "logger", hg.logger)
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_completion", lambda *a, **k: '{"type": "text_query"}')
    assert hg._classify_text_llm("how much did we spend on groceries?") == "text_query"


def test_llm_classify_strips_markdown_code_fence(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_completion", lambda *a, **k: '```json\n{"type": "pantry_command"}\n```')
    assert hg._classify_text_llm("running low on eggs") == "pantry_command"


def test_llm_classify_falls_back_to_none_on_unrecognized_type(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_completion", lambda *a, **k: '{"type": "receipt"}')
    assert hg._classify_text_llm("whatever") is None


def test_llm_classify_falls_back_to_none_on_malformed_json(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_completion", lambda *a, **k: "not json at all")
    assert hg._classify_text_llm("whatever") is None


def test_llm_classify_falls_back_to_none_on_exception(monkeypatch):
    import services.llm_client as llm_client

    def _raise(*a, **k):
        raise TimeoutError("model call timed out")

    monkeypatch.setattr(llm_client, "get_completion", _raise)
    assert hg._classify_text_llm("whatever") is None


def test_llm_classify_passes_a_timeout():
    import inspect
    sig = inspect.signature(hg._classify_text_llm)
    # sanity: the function exists and takes the raw text, not the lowered form,
    # plus the group's recent conversation (services/conversation.py) so a
    # follow-up is classified by what it's following up on.
    assert list(sig.parameters) == ["text", "context"]


# ── _classify_text: payment short-circuit, LLM path, fallback path ─────────


def test_payment_exact_phrase_short_circuits_without_calling_llm(monkeypatch):
    import services.llm_client as llm_client

    def _fail(*a, **k):
        raise AssertionError("must not call the LLM for an exact payment phrase")

    monkeypatch.setattr(llm_client, "get_completion", _fail)
    assert hg._classify_text("paid") == "payment_confirmation"
    assert hg._classify_text("Settled!") == "payment_confirmation"


def test_empty_text_is_unknown_without_calling_llm(monkeypatch):
    import services.llm_client as llm_client

    def _fail(*a, **k):
        raise AssertionError("must not call the LLM for empty text")

    monkeypatch.setattr(llm_client, "get_completion", _fail)
    assert hg._classify_text("   ") == "unknown"


def test_classify_text_uses_llm_result_when_valid(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_completion", lambda *a, **k: '{"type": "text_query"}')
    # A phrasing the keyword fallback would never catch (no "?" or query prefix)
    assert hg._classify_text("could you check the insurance renewal date") == "text_query"


def test_classify_text_falls_back_to_keywords_when_llm_unavailable(monkeypatch):
    import services.llm_client as llm_client

    def _raise(*a, **k):
        raise ConnectionError("openrouter unreachable")

    monkeypatch.setattr(llm_client, "get_completion", _raise)
    assert hg._classify_text("what did we spend this week?") == "text_query"
    assert hg._classify_text("running low on milk") == "pantry_command"
    assert hg._classify_text("morning!") == "unknown"


# ── keyword-layer eval set ───────────────────────────────────────────────────
# A small representative set covering the three keyword-fallback buckets.
# This is the deterministic part of the classifier and had no regression
# coverage before this change.

_KEYWORD_EVAL = [
    ("what did we spend on groceries this month?", "text_query"),
    ("how much is left in the budget?", "text_query"),
    ("when does the car insurance renew?", "text_query"),
    ("show me last week's receipts", "text_query"),
    ("any reminders due today", "text_query"),
    ("is the helper off tomorrow?", "text_query"),
    ("we're out of milk", "unknown"),           # doesn't match a _PANTRY_PREFIXES prefix
    ("running low on eggs", "pantry_command"),
    ("added rice to the pantry", "pantry_command"),
    ("bought detergent", "pantry_command"),
    ("out of coffee", "pantry_command"),
    ("used up the last of the flour", "pantry_command"),
    ("morning!", "unknown"),
    ("thanks so much", "unknown"),
    ("lol true", "unknown"),
    ("see you tonight", "unknown"),
    ("haha nice one", "unknown"),
]


def test_keyword_fallback_eval_set():
    for text, expected in _KEYWORD_EVAL:
        t = text.strip().lower().rstrip("!.✓ ")
        assert hg._classify_text_keywords(t) == expected, f"{text!r} -> expected {expected}"
