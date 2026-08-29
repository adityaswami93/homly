"""agents/homly_graph.py's classify_node image path.

Bug this covers: every photo used to get `engage: True` hardcoded, regardless
of the household's engagement mode — so an unrecognized photo (a family
picture, a meme, a screenshot) triggered an unsolicited bot reply even in
`mentioned` mode, where the whole point is "only speak when spoken to".
classify_node now runs images through the same services.bot_profile.should_engage()
gate text does, and an unrecognized photo ("other_image") gets its own honest
fixed reply instead of being silently handed to the chat orchestrator, which
has no way to see the photo — only whatever caption text (if any) came with it.
"""
import json
from dataclasses import replace

import agents.homly_graph as hg
from services import bot_profile


def _vision_json(img_type: str) -> str:
    return json.dumps({"type": img_type})


def _base_state(**overrides) -> dict:
    state = {
        "household_id": "",  # bot_profile.get_profile("") -> DEFAULT_PROFILE, no DB call
        "group_jid": "123@g.us",
        "query": None,
        "image_bytes": b"fake-image-bytes",
        "image_mime": "image/jpeg",
        "was_mentioned": False,
        "is_reply_to_bot": False,
    }
    state.update(overrides)
    return state


def _profile(**overrides) -> bot_profile.BotProfile:
    return replace(bot_profile.DEFAULT_PROFILE, **overrides)


# ── other_image: gated like an unaddressed text message ────────────────────


def test_other_image_not_addressed_smart_mode_does_not_engage(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_vision_completion", lambda *a, **k: _vision_json("other_image"))

    result = hg.classify_node(_base_state())
    assert result["message_type"] == "other_image"
    assert result["engage"] is False


def test_other_image_addressed_via_mention_engages(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_vision_completion", lambda *a, **k: _vision_json("other_image"))

    result = hg.classify_node(_base_state(was_mentioned=True))
    assert result["message_type"] == "other_image"
    assert result["engage"] is True
    assert result["addressed"] is True


def test_other_image_addressed_via_name_in_caption_engages(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_vision_completion", lambda *a, **k: _vision_json("other_image"))

    result = hg.classify_node(_base_state(query="hey Homly, check this out"))
    assert result["engage"] is True


def test_other_image_not_addressed_always_mode_engages(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_vision_completion", lambda *a, **k: _vision_json("other_image"))
    monkeypatch.setattr(bot_profile, "get_profile", lambda hid: _profile(engagement_mode="always"))

    result = hg.classify_node(_base_state())
    assert result["engage"] is True


def test_other_image_not_addressed_mentioned_mode_does_not_engage(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_vision_completion", lambda *a, **k: _vision_json("other_image"))
    monkeypatch.setattr(bot_profile, "get_profile", lambda hid: _profile(engagement_mode="mentioned"))

    result = hg.classify_node(_base_state())
    assert result["engage"] is False


# ── receipt/recipe/fridge_scan: unchanged always-engage behavior ───────────


def test_receipt_always_engages_even_unaddressed_mentioned_mode(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_vision_completion", lambda *a, **k: _vision_json("receipt"))
    monkeypatch.setattr(bot_profile, "get_profile", lambda hid: _profile(engagement_mode="mentioned"))

    result = hg.classify_node(_base_state())
    assert result["message_type"] == "receipt"
    assert result["engage"] is True


def test_food_photo_maps_to_recipe_and_always_engages(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_vision_completion", lambda *a, **k: _vision_json("food_photo"))
    monkeypatch.setattr(bot_profile, "get_profile", lambda hid: _profile(engagement_mode="mentioned"))

    result = hg.classify_node(_base_state())
    assert result["message_type"] == "recipe"
    assert result["engage"] is True


def test_fridge_scan_caption_always_engages_even_unaddressed_mentioned_mode(monkeypatch):
    # Caption-keyword path never calls the vision classifier at all.
    monkeypatch.setattr(bot_profile, "get_profile", lambda hid: _profile(engagement_mode="mentioned"))

    result = hg.classify_node(_base_state(query="what's in the fridge"))
    assert result["message_type"] == "fridge_scan"
    assert result["engage"] is True


# ── route_by_type: other_image routes to its own honest-reply node ─────────


def test_route_by_type_sends_engaged_other_image_to_unsupported_image_node():
    state = {"message_type": "other_image", "engage": True}
    assert hg.route_by_type(state) == "other_image"


def test_route_by_type_silences_ungated_other_image():
    state = {"message_type": "other_image", "engage": False}
    assert hg.route_by_type(state) == "silent"


def test_unsupported_image_node_answers_honestly_without_agent_results():
    result = hg.unsupported_image_node({})
    assert "response" in result
    assert result["response"]


# ── graph wiring: other_image reaches unsupported_image_node end-to-end ────


def test_graph_routes_other_image_to_unsupported_image_reply(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_vision_completion", lambda *a, **k: _vision_json("other_image"))

    result = hg.graph.invoke(_base_state(was_mentioned=True))
    assert result["response"] == hg.unsupported_image_node({})["response"]


def test_graph_stays_silent_for_ungated_other_image(monkeypatch):
    import services.llm_client as llm_client
    monkeypatch.setattr(llm_client, "get_vision_completion", lambda *a, **k: _vision_json("other_image"))

    result = hg.graph.invoke(_base_state())
    assert result.get("response") is None
