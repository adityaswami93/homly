import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

# Outgoing message queue — bot polls /internal/messages and drains this
_outgoing: list[dict] = []


def _record(chat_id: str, text: str, household_id: str | None) -> None:
    """Log what the bot said into the group's conversation transcript.

    Done here rather than at each call site on purpose: this queue is the one
    choke point every bot-initiated message goes through — pantry confirmation
    prompts, weekly summaries, insurance renewal reminders, proactive
    notifications, /messages/send. Recording per caller would mean five places
    to remember, and the one that got missed would be a hole in the
    assistant's memory of its own words. household_id is optional because
    several of those callers only know the group JID; services/conversation.py
    resolves it. Never raises — a transcript write must not stop a send.
    """
    try:
        from services import conversation
        conversation.record_assistant_message(household_id, chat_id, text)
    except Exception as e:
        logger.warning(f"[whatsapp_client] could not record outgoing message: {e}")


async def download_file(url: str, timeout: int = 30) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content
    except Exception as e:
        logger.error(f"[whatsapp_client] download_file failed: {e}")
        return None


async def send_text(chat_id: str, text: str, household_id: str | None = None) -> bool:
    _outgoing.append({"group_jid": chat_id, "text": text})
    await asyncio.to_thread(_record, chat_id, text, household_id)
    return True


def pop_outgoing() -> list[dict]:
    msgs = list(_outgoing)
    _outgoing.clear()
    return msgs


def send_text_sync(chat_id: str, text: str, household_id: str | None = None) -> None:
    """Synchronous wrapper for send_text — safe to call from graph nodes."""
    _outgoing.append({"group_jid": chat_id, "text": text})
    _record(chat_id, text, household_id)


def is_configured() -> bool:
    return True
