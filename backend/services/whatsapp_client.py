import logging
import httpx

logger = logging.getLogger(__name__)

# Outgoing message queue — bot polls /internal/messages and drains this
_outgoing: list[dict] = []


async def download_file(url: str, timeout: int = 30) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content
    except Exception as e:
        logger.error(f"[whatsapp_client] download_file failed: {e}")
        return None


async def send_text(chat_id: str, text: str) -> bool:
    _outgoing.append({"group_jid": chat_id, "text": text})
    return True


def pop_outgoing() -> list[dict]:
    msgs = list(_outgoing)
    _outgoing.clear()
    return msgs


def is_configured() -> bool:
    return True
