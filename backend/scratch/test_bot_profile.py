"""
Standalone smoke-test for services/bot_profile.py.  No pytest — just asserts
and print statements, matching scratch/test_graph.py.
Run with:  python backend/scratch/test_bot_profile.py

Covers the pure logic only (should_engage, mentions_name, _coerce) — no DB, so
this runs without SUPABASE_URL/SUPABASE_KEY set. get_profile() itself is a thin
query over these.
"""
import os
import sys
import types

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# bot_profile imports supabase at module scope for get_profile(); nothing below
# calls it, so a stub keeps this runnable without the backend deps installed.
if "supabase" not in sys.modules:
    stub = types.ModuleType("supabase")
    stub.create_client = lambda *a, **k: None
    sys.modules["supabase"] = stub

from services.bot_profile import (  # noqa: E402
    BotProfile, DEFAULT_PROFILE, _coerce, mentions_name, should_engage,
)

failures = []


def check(label, got, want):
    if got == want:
        print(f"  ✅ {label}")
    else:
        print(f"  ❌ {label}: got {got!r}, want {want!r}")
        failures.append(label)


# ── 1. should_engage — the gate that decides whether the bot speaks ──────────

print("\n[1] should_engage")

smart     = BotProfile(engagement_mode="smart")
mentioned = BotProfile(engagement_mode="mentioned")
always    = BotProfile(engagement_mode="always")

# The regression this whole change exists to fix: unclassifiable chatter used
# to route to END. Addressed, it must now reach the assistant in every mode.
check("smart: 'morning!' addressed",        should_engage("unknown", smart, True), True)
check("smart: 'morning!' not addressed",    should_engage("unknown", smart, False), False)
check("mentioned: 'morning!' addressed",    should_engage("unknown", mentioned, True), True)
check("mentioned: 'morning!' not addressed", should_engage("unknown", mentioned, False), False)
check("always: 'morning!' not addressed",   should_engage("unknown", always, False), True)

# An actionable question needs no mention in smart/always, but does in mentioned.
check("smart: question, no mention",      should_engage("text_query", smart, False), True)
check("always: question, no mention",     should_engage("text_query", always, False), True)
check("mentioned: question, no mention",  should_engage("text_query", mentioned, False), False)
check("mentioned: question, addressed",   should_engage("text_query", mentioned, True), True)
check("smart: pantry cmd, no mention",    should_engage("pantry_command", smart, False), True)

# Always-engage types must survive even the quietest mode — a receipt is an
# explicit action, and swallowing a pantry_confirmation would strand the
# confirmation flow with a prompt nobody can answer.
for mtype in ("receipt", "recipe", "fridge_scan", "pantry_confirmation", "payment_confirmation"):
    check(f"mentioned: {mtype} always handled", should_engage(mtype, mentioned, False), True)


# ── 2. mentions_name — whole-word, so short names don't over-match ───────────

print("\n[2] mentions_name")

check("plain name",            mentions_name("homly what's for dinner", "Homly"), True)
check("case-insensitive",      mentions_name("HOMLY?", "Homly"), True)
check("with punctuation",      mentions_name("thanks, Homly!", "Homly"), True)
check("absent",                mentions_name("what did we spend", "Homly"), False)
# The reason mentions_name uses \b: a household that renames the bot "Ari"
# must not have it answer every "are we out of milk".
check("short name not substring", mentions_name("are we out of milk", "Ari"), False)
check("short name whole word",    mentions_name("ari, are we out of milk", "Ari"), True)
check("name inside longer word",  mentions_name("homlywood", "Homly"), False)
check("empty text",               mentions_name("", "Homly"), False)
check("one-char name ignored",    mentions_name("a b c", "a"), False)


# ── 3. _coerce — a settings row from before migration 033 must not break ─────

print("\n[3] _coerce fallbacks")

check("empty row → defaults",     _coerce({}), DEFAULT_PROFILE)
check("null name → default",      _coerce({"bot_name": None}).name, "Homly")
check("blank name → default",     _coerce({"bot_name": "   "}).name, "Homly")
check("bad mode → smart",         _coerce({"bot_engagement_mode": "chatty"}).engagement_mode, "smart")
check("bad tone → warm",          _coerce({"bot_tone": "sarcastic"}).tone, "warm")
check("mode normalised",          _coerce({"bot_engagement_mode": "ALWAYS"}).engagement_mode, "always")
check("null casual → True",       _coerce({"bot_casual_chat": None}).casual_chat, True)
check("false casual honoured",    _coerce({"bot_casual_chat": False}).casual_chat, False)
check("false proactive honoured", _coerce({"bot_proactive_enabled": False}).proactive_enabled, False)
check("custom name kept",         _coerce({"bot_name": " Jarvis "}).name, "Jarvis")


print()
if failures:
    print(f"❌ {len(failures)} check(s) failed: {failures}")
    sys.exit(1)
print("✅ all bot_profile checks passed")
