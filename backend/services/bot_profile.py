"""Per-household assistant configuration — who the bot is, and when it speaks.

This is the single source of truth for two things that used to be hard-coded:

  * **Persona** (`bot_name`, `bot_tone`, `bot_casual_chat`) — folded into both
    agents/orchestrator/supervisor.py's and agents/proactive_agent.py's system
    prompts on every run, alongside services/preferences.py's remembered
    preferences.

  * **Engagement** (`bot_engagement_mode`) — whether a given group message
    should reach the assistant at all. See should_engage() below; that function
    is the *only* place the rule lives, so the WhatsApp path and any future
    caller can't drift apart on it.

The columns live on `settings` (migration 033_bot_personality.sql) and are
edited from the dashboard's Settings → Assistant tab.
"""
import logging
import os
import re
from dataclasses import dataclass

from supabase import create_client

logger = logging.getLogger(__name__)

ENGAGEMENT_MODES = ("mentioned", "smart", "always")
TONES = ("warm", "concise", "playful")

DEFAULT_NAME = "Homly"
DEFAULT_ENGAGEMENT_MODE = "smart"
DEFAULT_TONE = "warm"

# Message types the assistant handles regardless of engagement mode.
#
# A photo of a receipt or a fridge is an explicit action — somebody deliberately
# sent it to the group the bot lives in — so it is never "chatter" to stay out
# of. `pantry_confirmation` and `payment_confirmation` answer a question the bot
# itself asked, or are exact-match phrases only meaningful to the bot; ignoring
# those in 'mentioned' mode would strand the pantry confirmation flow with an
# open prompt nobody can close.
_ALWAYS_ENGAGE = frozenset({
    "receipt", "recipe", "fridge_scan", "pantry_confirmation", "payment_confirmation",
})

# Types the keyword classifier recognised as an actionable request. In 'smart'
# mode these get answered without needing to be addressed; in 'mentioned' mode
# they don't.
_ACTIONABLE = frozenset({"text_query", "pantry_command"})

_TONE_GUIDANCE = {
    "warm": (
        "Warm and personable — like a friend who happens to keep track of this stuff. "
        "Full sentences, a little natural conversational texture, never gushing."
    ),
    "concise": (
        "Brief and matter-of-fact. Lead with the answer, skip the pleasantries and the "
        "follow-up offers unless they genuinely matter. Still friendly, never curt."
    ),
    "playful": (
        "Light and a bit witty — the household's funny friend. A joke or an aside is "
        "welcome when it fits, but the answer always comes first and stays accurate."
    ),
}

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


@dataclass(frozen=True)
class BotProfile:
    name: str = DEFAULT_NAME
    engagement_mode: str = DEFAULT_ENGAGEMENT_MODE
    tone: str = DEFAULT_TONE
    casual_chat: bool = True
    proactive_enabled: bool = True


DEFAULT_PROFILE = BotProfile()


def _coerce(row: dict) -> BotProfile:
    """Build a profile from a settings row, falling back per-field.

    Deliberately tolerant: a household whose settings row predates migration
    033 (or was written by an older deploy) is missing these keys entirely, and
    a half-configured assistant should degrade to the defaults rather than
    raise on a WhatsApp message.
    """
    name = (row.get("bot_name") or "").strip() or DEFAULT_NAME

    mode = (row.get("bot_engagement_mode") or "").strip().lower()
    if mode not in ENGAGEMENT_MODES:
        mode = DEFAULT_ENGAGEMENT_MODE

    tone = (row.get("bot_tone") or "").strip().lower()
    if tone not in TONES:
        tone = DEFAULT_TONE

    casual = row.get("bot_casual_chat")
    proactive = row.get("bot_proactive_enabled")

    return BotProfile(
        name=name,
        engagement_mode=mode,
        tone=tone,
        casual_chat=True if casual is None else bool(casual),
        proactive_enabled=True if proactive is None else bool(proactive),
    )


def get_profile(household_id: str) -> BotProfile:
    """This household's assistant config, or the defaults if anything fails.

    Never raises — an unreachable settings row must not take the bot offline,
    and the defaults are the most responsive setting, so degrading to them
    can't silence a household that expected a reply.
    """
    if not household_id:
        return DEFAULT_PROFILE
    try:
        res = (
            _db().table("settings")
            .select("bot_name, bot_engagement_mode, bot_tone, bot_casual_chat, bot_proactive_enabled")
            .eq("household_id", household_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error(f"[bot_profile] settings fetch failed for {household_id}: {e}")
        return DEFAULT_PROFILE

    rows = res.data or []
    return _coerce(rows[0]) if rows else DEFAULT_PROFILE


def mentions_name(text: str, bot_name: str) -> bool:
    """True if `text` names the bot.

    Whole-word match so a bot named "Ari" doesn't fire on "are we out of milk".
    The WhatsApp bot already detects @-mentions and replies-to-the-bot itself
    (it knows its own JID); this covers the third way a person addresses an
    assistant — just calling it by name.
    """
    name = (bot_name or "").strip()
    if not text or len(name) < 2:
        return False
    return re.search(rf"\b{re.escape(name)}\b", text, flags=re.IGNORECASE) is not None


def should_engage(message_type: str | None, profile: BotProfile, addressed: bool) -> bool:
    """Whether the assistant should respond to this message.

    The bot lives in a shared household group, so it sees every message members
    send each other, not just the ones meant for it. This is the gate that keeps
    it from talking over the family — and, equally, the gate that stops a
    perfectly ordinary "morning!" from falling into silence.
    """
    if message_type in _ALWAYS_ENGAGE:
        return True
    if addressed:
        return True
    if profile.engagement_mode == "always":
        return True
    if profile.engagement_mode == "smart":
        return message_type in _ACTIONABLE
    # 'mentioned' — spoken to only.
    return False


def describe_for_prompt(profile: BotProfile, include_chat_guidance: bool = True) -> str:
    """The persona block prepended to the assistant's system prompt.

    `include_chat_guidance=False` for the proactive monitor: nobody is talking
    to it on a scheduled run, so guidance about small talk and out-of-scope
    questions has nothing to apply to.
    """
    lines = [
        f"You are {profile.name}, this household's personal assistant.",
        f"Tone: {_TONE_GUIDANCE.get(profile.tone, _TONE_GUIDANCE[DEFAULT_TONE])}",
    ]
    if not include_chat_guidance:
        return "\n".join(lines)
    if profile.casual_chat:
        lines.append(
            "Small talk and casual questions are welcome — greetings, thanks, and asides get a "
            "natural human reply, not a menu of features. If someone asks something outside what "
            "your tools cover (a recipe idea, what to do about a rainy weekend), give a genuine, "
            "useful opinion the way a friend would, keep it short, and be honest that it's just "
            "your take rather than something you looked up in their records. Never present a "
            "guess about their own data as fact — that always comes from a tool."
        )
    else:
        lines.append(
            "Keep to this household's affairs. For small talk, reply briefly and warmly without "
            "elaborating. If someone asks something outside what your tools cover, say so kindly "
            "in one line and point to the closest thing you can actually help with — never lecture "
            "and never recite your full capability list."
        )
    return "\n".join(lines)
