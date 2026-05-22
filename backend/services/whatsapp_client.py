import logging

logger = logging.getLogger(__name__)

# Outgoing message queue — bot polls /internal/messages and drains this
_outgoing: list[dict] = []


async def send_text(chat_id: str, text: str) -> bool:
    _outgoing.append({"group_jid": chat_id, "text": text})
    return True


def pop_outgoing() -> list[dict]:
    msgs = list(_outgoing)
    _outgoing.clear()
    return msgs


def is_configured() -> bool:
    return True
