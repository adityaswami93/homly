"""services/bot_profile.py — the gate deciding whether the assistant speaks at all.

The bot sits in the household's *shared* WhatsApp group, so /internal/graph-invoke
sees every message members send each other. should_engage() is the only place
the rule for answering lives (CLAUDE.md: "don't re-derive it in a caller"), which
makes it worth pinning directly rather than through the graph.

The regression behind these: classify_node's image branch once hard-coded
engage=True for every photo regardless of mode, so the bot piped up on any
family photo shared in the group. The mirror-image failure matters just as much
— unclassifiable chatter used to route to END, leaving something that presents
itself as an assistant silently ignoring "morning!".

Promoted from scratch/test_bot_profile.py, which ran the same checks as bare
asserts outside pytest and therefore outside CI.
"""
import sys
import types

# bot_profile imports services.db at module scope for get_profile(). Nothing
# here calls it, and services.db pulls in supabase/httpx/dotenv — so stub it
# when those aren't installed. In CI they are, and the real module imports
# fine (it builds no client until get_supabase() is called).
try:  # pragma: no cover - depends on the environment, not the code
    import services.db  # noqa: F401
except ImportError:  # pragma: no cover
    _stub = types.ModuleType("services.db")
    _stub.get_supabase = lambda: None
    sys.modules["services.db"] = _stub

from services.bot_profile import (  # noqa: E402
    DEFAULT_PROFILE,
    BotProfile,
    _coerce,
    describe_for_prompt,
    mentions_name,
    should_engage,
)

SMART = BotProfile(engagement_mode="smart")
MENTIONED = BotProfile(engagement_mode="mentioned")
ALWAYS = BotProfile(engagement_mode="always")

# Deliberate, unambiguous actions that bypass the gate in every mode.
# Swallowing a pantry_confirmation in particular would strand the flow with a
# prompt nobody can close.
ALWAYS_ENGAGE_TYPES = ("receipt", "recipe", "fridge_scan", "pantry_confirmation", "payment_confirmation")


# ── should_engage: unaddressed chatter ──────────────────────────────────────


def test_unclassifiable_chatter_reaches_the_assistant_when_addressed():
    for profile in (SMART, MENTIONED, ALWAYS):
        assert should_engage("unknown", profile, True) is True


def test_unclassifiable_chatter_is_ignored_when_not_addressed_except_in_always():
    assert should_engage("unknown", SMART, False) is False
    assert should_engage("unknown", MENTIONED, False) is False
    assert should_engage("unknown", ALWAYS, False) is True


# ── should_engage: actionable messages ──────────────────────────────────────


def test_smart_mode_answers_an_actionable_question_without_being_addressed():
    assert should_engage("text_query", SMART, False) is True
    assert should_engage("pantry_command", SMART, False) is True


def test_mentioned_mode_requires_addressing_even_for_a_question():
    assert should_engage("text_query", MENTIONED, False) is False
    assert should_engage("text_query", MENTIONED, True) is True


# ── should_engage: the bypass set ───────────────────────────────────────────


def test_deliberate_actions_are_handled_in_the_quietest_mode():
    for message_type in ALWAYS_ENGAGE_TYPES:
        assert should_engage(message_type, MENTIONED, False) is True, message_type


def test_an_unrecognised_photo_is_gated_like_ordinary_chatter():
    # other_image is deliberately NOT in the bypass set: a meme or family photo
    # is not a deliberate action, and treating it as one is the bug that made
    # the bot comment on every picture shared in the group.
    assert should_engage("other_image", MENTIONED, False) is False
    assert should_engage("other_image", SMART, False) is False
    assert should_engage("other_image", MENTIONED, True) is True


# ── mentions_name ───────────────────────────────────────────────────────────


def test_name_is_matched_case_insensitively_and_through_punctuation():
    assert mentions_name("homly what's for dinner", "Homly") is True
    assert mentions_name("HOMLY?", "Homly") is True
    assert mentions_name("thanks, Homly!", "Homly") is True
    assert mentions_name("what did we spend", "Homly") is False


def test_a_short_name_does_not_match_inside_another_word():
    # Why mentions_name uses \b: a household that renames the bot "Ari" must
    # not have it answer every "are we out of milk".
    assert mentions_name("are we out of milk", "Ari") is False
    assert mentions_name("ari, are we out of milk", "Ari") is True
    assert mentions_name("homlywood", "Homly") is False


def test_empty_text_or_a_one_character_name_never_matches():
    assert mentions_name("", "Homly") is False
    assert mentions_name("a b c", "a") is False


def test_a_regex_special_character_in_the_name_is_escaped():
    # bot_name is user-supplied from the Settings page; an unescaped "." would
    # match any character, and an unbalanced "(" would raise mid-message.
    assert mentions_name("ask c.a.t about it", "c.a.t") is True
    assert mentions_name("ask cXaXt about it", "c.a.t") is False
    assert mentions_name("hello there", "what(") is False


# ── _coerce: rows written before migration 034 ──────────────────────────────


def test_an_empty_settings_row_yields_the_default_profile():
    assert _coerce({}) == DEFAULT_PROFILE


def test_null_or_blank_values_fall_back_per_field():
    assert _coerce({"bot_name": None}).name == "Homly"
    assert _coerce({"bot_name": "   "}).name == "Homly"
    assert _coerce({"bot_casual_chat": None}).casual_chat is True


def test_an_unrecognised_mode_or_tone_falls_back_rather_than_propagating():
    assert _coerce({"bot_engagement_mode": "chatty"}).engagement_mode == "smart"
    assert _coerce({"bot_tone": "sarcastic"}).tone == "warm"


def test_values_are_normalised_and_trimmed():
    assert _coerce({"bot_engagement_mode": "ALWAYS"}).engagement_mode == "always"
    assert _coerce({"bot_name": " Jarvis "}).name == "Jarvis"


def test_an_explicit_false_is_honoured_and_not_treated_as_missing():
    # The `or default` bug class: False must survive, unlike None.
    assert _coerce({"bot_casual_chat": False}).casual_chat is False
    assert _coerce({"bot_proactive_enabled": False}).proactive_enabled is False


# ── describe_for_prompt ─────────────────────────────────────────────────────


def test_the_persona_block_names_the_bot_and_its_tone():
    text = describe_for_prompt(BotProfile(name="Jarvis", tone="concise"))
    assert "Jarvis" in text


def test_the_proactive_run_drops_chat_guidance():
    # Nothing is talking to the proactive monitor, so small-talk guidance has
    # nothing to apply to — and every wasted token is in every scheduled run.
    profile = BotProfile(casual_chat=True)
    assert len(describe_for_prompt(profile, include_chat_guidance=False)) < len(
        describe_for_prompt(profile, include_chat_guidance=True)
    )
