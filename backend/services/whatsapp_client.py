import os
import httpx
import logging

logger = logging.getLogger(__name__)


def _instance_id() -> str:
    return os.getenv("GREEN_API_INSTANCE_ID", "")


def _api_token() -> str:
    return os.getenv("GREEN_API_TOKEN", "")


def _url(method: str) -> str:
    return f"https://api.green-api.com/waInstance{_instance_id()}/{method}/{_api_token()}"


def is_configured() -> bool:
    return bool(_instance_id() and _api_token())


async def send_text(chat_id: str, text: str) -> bool:
    if not is_configured():
        logger.warning("[whatsapp] credentials not set — message not sent")
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(_url("sendMessage"), json={"chatId": chat_id, "message": text})
            res.raise_for_status()
            return True
    except Exception as e:
        logger.error(f"[whatsapp] sendMessage to {chat_id} failed: {e}")
        return False


async def get_state() -> dict:
    if not is_configured():
        return {"stateInstance": "not_configured"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(_url("getStateInstance"))
            res.raise_for_status()
            return res.json()
    except Exception as e:
        logger.error(f"[whatsapp] getStateInstance failed: {e}")
        return {"stateInstance": "error"}


async def get_qr() -> dict:
    if not is_configured():
        return {"type": "error", "message": "credentials_not_configured"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(_url("qr"))
            res.raise_for_status()
            return res.json()
    except Exception as e:
        logger.error(f"[whatsapp] qr fetch failed: {e}")
        return {"type": "error", "message": str(e)}


async def get_groups() -> list[dict]:
    if not is_configured():
        return []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(_url("getContacts"))
            res.raise_for_status()
            contacts = res.json()
            if isinstance(contacts, list):
                return [
                    {"id": c.get("id"), "name": c.get("name", c.get("id", ""))}
                    for c in contacts
                    if isinstance(c, dict) and c.get("id", "").endswith("@g.us")
                ]
    except Exception as e:
        logger.error(f"[whatsapp] getContacts failed: {e}")
    return []


async def download_file(url: str) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.get(url)
            res.raise_for_status()
            return res.content
    except Exception as e:
        logger.error(f"[whatsapp] download_file failed: {e}")
        return None
