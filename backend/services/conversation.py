"""Short-term memory for the WhatsApp assistant — the group's recent chat.

The bot makes one stateless HTTP request per incoming message, so without a
transcript every message is reasoned about in isolation: the assistant can't
resolve "how much then?", can't tell what a bare "yes" or an emoji is
reacting to, and answers a reply to its own message as if it had never spoken.
This module is that transcript (table `conversation_messages`, migration
035_conversation_messages.sql) — and it is the *only* place the "what counts
as the current conversation" rules live:

  * how many turns are recent enough to matter (_CONTEXT_TURNS)
  * how long a conversation stays live (_CONTEXT_MAX_AGE_MINUTES)
  * whether the bot's own last message is still awaiting a reply
    (is_awaiting_reply — the follow-up addressing signal in
    agents/homly_graph.py's classify_node)

Both directions are recorded, including messages the engagement gate decided
not to answer — those are the conversation the assistant is sitting in, and
dropping them is exactly what made its replies read as context-free.

Nothing here raises: a transcript that can't be written or read must never
stop a household's message from being answered. Every failure degrades to
"no memory", which is the behaviour that existed before this module.
"""
import logging
import os
from datetime import datetime, timedelta, timezone as tz

from supabase import create_client

logger = logging.getLogger(__name__)

# How much of the group's chat the assistant is handed on each message. Sized
# for a family group: enough to cover a back-and-forth (question, answer,
# follow-up, someone else chiming in), short enough to stay cheap on every
# single message.
_CONTEXT_TURNS = 20

# Older than this and it isn't "the conversation" any more — it's history the
# assistant should look up with a tool rather than assume is still in the air.
_CONTEXT_MAX_AGE_MINUTES = 6 * 60

# One turn is truncated to this before going into a prompt. Bot replies can be
# long (a weekly summary, a fridge scan list) and the point of context is the
# thread of the conversation, not a verbatim archive.
_MAX_CONTENT_CHARS = 800

# A message arriving this soon after the bot's own last message, with nothing
# in between, is a reply to it — see is_awaiting_reply().
_FOLLOW_UP_WINDOW_MINUTES = 10

_supabase = None

# group_jid -> household_id. Only ever grows within a process, and the mapping
# only changes when a household reconnects to a different group (rare, and a
# stale entry self-corrects on the next deploy/restart).
_household_by_jid: dict[str, str] = {}


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


def _now() -> datetime:
    return datetime.now(tz.utc)


def _parse_ts(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=tz.utc)
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def resolve_household_id(group_jid: str) -> str | None:
    """household_id for a WhatsApp group, via settings.group_jid.

    Lets services/whatsapp_client.py record what the bot says without every
    caller having to thread household_id through — several of them (the
    scheduler's summaries, the proactive monitor) send to a group they
    identified by JID in the first place.
    """
    if not group_jid:
        return None
    cached = _household_by_jid.get(group_jid)
    if cached:
        return cached
    try:
        res = (
            _db().table("settings")
            .select("household_id")
            .eq("group_jid", group_jid)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error(f"[conversation] household lookup failed for {group_jid}: {e}")
        return None
    rows = res.data or []
    if not rows:
        return None
    household_id = rows[0]["household_id"]
    _household_by_jid[group_jid] = household_id
    return household_id


# ── Writing ───────────────────────────────────────────────────────────────────


def record_message(
    household_id: str | None,
    group_jid: str | None,
    role: str,
    content: str,
    sender_name: str | None = None,
    sender_phone: str | None = None,
    message_type: str | None = None,
    whatsapp_message_id: str | None = None,
) -> bool:
    """Append one turn. Returns False (never raises) if it couldn't be stored."""
    content = (content or "").strip()
    if not household_id or not group_jid or not content or role not in ("user", "assistant"):
        return False

    try:
        _db().table("conversation_messages").insert({
            "household_id": household_id,
            "group_jid": group_jid,
            "role": role,
            "content": content[:4000],
            "sender_name": sender_name,
            "sender_phone": sender_phone,
            "message_type": message_type,
            "whatsapp_message_id": whatsapp_message_id,
        }).execute()
        return True
    except Exception as e:
        # A duplicate whatsapp_message_id lands here too (partial unique index
        # in the migration) — that's a redelivery, and skipping it is the point.
        logger.warning(f"[conversation] could not record {role} message: {e}")
        return False


def record_user_message(household_id, group_jid, content, sender_name=None,
                        sender_phone=None, whatsapp_message_id=None) -> bool:
    return record_message(
        household_id, group_jid, "user", content,
        sender_name=sender_name, sender_phone=sender_phone,
        whatsapp_message_id=whatsapp_message_id,
    )


def record_assistant_message(household_id, group_jid, content, message_type=None) -> bool:
    """Record something the bot said. `household_id` may be None — it is then
    resolved from the group JID, so transport-level callers don't need it."""
    if not household_id:
        household_id = resolve_household_id(group_jid)
    return record_message(household_id, group_jid, "assistant", content, message_type=message_type)


# ── Reading ───────────────────────────────────────────────────────────────────


def get_context(
    household_id: str,
    group_jid: str | None,
    limit: int = _CONTEXT_TURNS,
    max_age_minutes: int = _CONTEXT_MAX_AGE_MINUTES,
) -> list[dict]:
    """The recent conversation, oldest first, shaped for run_query()'s `context`.

    Each entry carries the `role`/`content` pair the supervisor turns into LLM
    messages, plus `created_at`/`sender_name`, which the extra consumers here
    (is_awaiting_reply, render_for_prompt) need. Extra keys are ignored by
    agents/orchestrator/supervisor.py's _to_lc_messages.
    """
    if not household_id or not group_jid:
        return []

    since = (_now() - timedelta(minutes=max_age_minutes)).isoformat()
    try:
        res = (
            _db().table("conversation_messages")
            .select("role, content, sender_name, created_at")
            .eq("household_id", household_id)
            .eq("group_jid", group_jid)
            .gte("created_at", since)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as e:
        logger.error(f"[conversation] context fetch failed for {group_jid}: {e}")
        return []

    rows = list(reversed(res.data or []))
    return [
        {
            "role": r.get("role") or "user",
            # A group chat has more than two speakers, so who said it is part of
            # the message — without the name the assistant can't tell the person
            # it's replying to from the two others talking around them.
            "content": _label(r),
            "sender_name": r.get("sender_name"),
            "created_at": r.get("created_at"),
        }
        for r in rows
        if (r.get("content") or "").strip()
    ]


def _label(row: dict) -> str:
    content = (row.get("content") or "").strip()[:_MAX_CONTENT_CHARS]
    sender = (row.get("sender_name") or "").strip()
    if row.get("role") == "user" and sender:
        return f"{sender}: {content}"
    return content


def is_awaiting_reply(context: list[dict], window_minutes: int = _FOLLOW_UP_WINDOW_MINUTES) -> bool:
    """True if the bot spoke last and recently — so the next message is a reply to it.

    This is the fourth addressing signal in agents/homly_graph.py's
    classify_node, alongside the @mention, the WhatsApp reply, and the bot's
    name: people don't re-address an assistant mid-conversation, they just keep
    talking. Deliberately narrow — any human message after the bot's makes the
    last entry theirs, so ordinary group chatter closes the window immediately.
    """
    if not context:
        return False
    last = context[-1]
    if last.get("role") != "assistant":
        return False
    ts = _parse_ts(last.get("created_at"))
    if ts is None:
        return False
    return (_now() - ts) <= timedelta(minutes=window_minutes)


def render_for_prompt(context: list[dict], turns: int = 6) -> str:
    """The tail of the conversation as plain text, for prompts that take a
    string rather than a message list (the text classifier in homly_graph.py).
    """
    if not context:
        return ""
    lines = []
    for entry in context[-turns:]:
        speaker = "Assistant" if entry.get("role") == "assistant" else "Group"
        lines.append(f"{speaker}: {entry.get('content', '')}")
    return "\n".join(lines)
