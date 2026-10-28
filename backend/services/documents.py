"""Long-term memory for photos the WhatsApp assistant has read.

services/conversation.py is short-term memory: the last few hours of chat,
with a photo recorded only as "[sent a photo] <caption>". This module is the
other half — table `household_documents` (migration 038) holds what was
actually *in* a photo the assistant read (agents/document_reader.py), so
"what did the school letter say about the excursion?" can be answered days
later by agents/query/documents_agent.py.

Retention is a code-level setting, on purpose: RETENTION_DAYS below. Each row
gets its own `expires_at` stamped from it on insert, and purge_expired() (run
daily by services/whatsapp_scheduler.py) deletes expired rows and their
images. A household can't change it from the dashboard; a row can be kept
longer by editing its expires_at directly.

Every query here filters by household_id — RLS is disabled on this table, so
that filter is the only thing keeping households apart.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone as tz

from services.db import get_supabase

logger = logging.getLogger(__name__)

# How long a read photo is remembered. Long enough to cover a school term's
# letters or a year of bills; short enough that the household isn't silently
# accumulating an archive of everything it ever photographed.
RETENTION_DAYS = 365

BUCKET = "household-documents"

_LIST_COLUMNS = (
    "id, doc_type, title, summary, key_facts, suggested_actions, caption, source, "
    "sender_name, image_path, mime_type, created_at, expires_at"
)

_EXT = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
    "image/webp": "webp", "application/pdf": "pdf",
}


def _db():
    return get_supabase()


def _now() -> datetime:
    return datetime.now(tz.utc)


def expiry_for(created_at: datetime | None = None, retention_days: int = RETENTION_DAYS) -> datetime:
    return (created_at or _now()) + timedelta(days=retention_days)


# ── Storage ───────────────────────────────────────────────────────────────────


def upload_image(file_bytes: bytes, mime_type: str, household_id: str,
                 bucket: str = BUCKET) -> str | None:
    """Store the original image. Returns its path, or None — losing the image
    must not lose the document: the extracted text is the part that's searchable."""
    try:
        ext = _EXT.get((mime_type or "").lower(), "bin")
        path = f"{household_id}/{uuid.uuid4().hex}.{ext}"
        _db().storage.from_(bucket).upload(
            path=path,
            file=file_bytes,
            file_options={"content-type": mime_type or "application/octet-stream", "upsert": "false"},
        )
        return path
    except Exception as e:
        logger.error(f"[documents] image upload to {bucket} failed for household {household_id}: {e}")
        return None


def signed_url(path: str | None, bucket: str = BUCKET, expires_in: int = 3600) -> str | None:
    if not path:
        return None
    try:
        signed = _db().storage.from_(bucket).create_signed_url(path=path, expires_in=expires_in)
        return signed.get("signedURL") or signed.get("signedUrl")
    except Exception as e:
        logger.warning(f"[documents] signed URL failed for {path}: {e}")
        return None


def download_image(path: str, bucket: str = BUCKET) -> bytes | None:
    try:
        return _db().storage.from_(bucket).download(path)
    except Exception as e:
        logger.warning(f"[documents] could not download {path} from {bucket}: {e}")
        return None


def _remove_images(paths: list[str], bucket: str = BUCKET) -> None:
    paths = [p for p in paths if p]
    if not paths:
        return
    try:
        _db().storage.from_(bucket).remove(paths)
    except Exception as e:
        logger.warning(f"[documents] could not remove {len(paths)} image(s) from {bucket}: {e}")


# ── Writing ───────────────────────────────────────────────────────────────────


def save_document(
    household_id: str,
    reading: dict,
    *,
    group_jid: str | None = None,
    source: str = "whatsapp",
    image_path: str | None = None,
    mime_type: str | None = None,
    caption: str | None = None,
    sender_name: str | None = None,
    sender_phone: str | None = None,
    whatsapp_message_id: str | None = None,
) -> dict | None:
    """Store one read photo. `reading` is agents/document_reader.read_image()'s
    output. Returns the stored row, the existing row on a WhatsApp redelivery,
    or None if it couldn't be stored (never raises)."""
    if whatsapp_message_id:
        existing = get_by_whatsapp_id(household_id, whatsapp_message_id)
        if existing:
            return existing

    row = {
        "household_id": household_id,
        "group_jid": group_jid,
        "source": source if source in ("whatsapp", "dashboard") else "whatsapp",
        "image_path": image_path,
        "mime_type": mime_type,
        "doc_type": reading.get("doc_type") or "other",
        "title": (reading.get("title") or "Untitled photo")[:200],
        "summary": reading.get("summary"),
        "extracted_text": reading.get("extracted_text"),
        "key_facts": reading.get("key_facts") or [],
        "suggested_actions": reading.get("suggested_actions") or [],
        "caption": caption,
        "sender_name": sender_name,
        "sender_phone": sender_phone,
        "whatsapp_message_id": whatsapp_message_id,
        "expires_at": expiry_for().isoformat(),
    }
    try:
        res = _db().table("household_documents").insert(row).execute()
        return (res.data or [None])[0]
    except Exception as e:
        logger.error(f"[documents] could not store document for household {household_id}: {e}")
        return None


def delete_document(household_id: str, document_id: str) -> bool:
    doc = get_document(household_id, document_id)
    if not doc:
        return False
    _db().table("household_documents").delete().eq("household_id", household_id).eq("id", document_id).execute()
    _remove_images([doc.get("image_path")])
    return True


def purge_expired(now: datetime | None = None) -> int:
    """Delete every expired document and its image, across all households.

    The one deliberately unscoped query in this module: it is the retention
    rule itself, run by the scheduler, and it only ever deletes rows whose own
    expires_at has passed. Returns how many rows were deleted.
    """
    cutoff = (now or _now()).isoformat()
    res = (
        _db().table("household_documents")
        .select("id, household_id, image_path")
        .lt("expires_at", cutoff)
        .limit(500)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return 0
    _remove_images([r.get("image_path") for r in rows])
    ids = [r["id"] for r in rows]
    _db().table("household_documents").delete().in_("id", ids).lt("expires_at", cutoff).execute()
    return len(rows)


# ── Reading ───────────────────────────────────────────────────────────────────


def _live(query):
    """Expired-but-not-yet-purged rows are already forgotten as far as anyone
    reading is concerned — the purge job only runs once a day."""
    return query.gte("expires_at", _now().isoformat())


def get_document(household_id: str, document_id: str) -> dict | None:
    try:
        res = _live(
            _db().table("household_documents")
            .select("*")
            .eq("household_id", household_id)
            .eq("id", document_id)
        ).limit(1).execute()
    except Exception as e:
        logger.warning(f"[documents] get failed for {document_id}: {e}")
        return None
    rows = res.data or []
    return rows[0] if rows else None


def get_by_whatsapp_id(household_id: str, whatsapp_message_id: str) -> dict | None:
    try:
        res = (
            _db().table("household_documents")
            .select("*")
            .eq("household_id", household_id)
            .eq("whatsapp_message_id", whatsapp_message_id)
            .limit(1)
            .execute()
        )
    except Exception:
        return None
    rows = res.data or []
    return rows[0] if rows else None


def recent_documents(household_id: str, limit: int = 5) -> list[dict]:
    res = _live(
        _db().table("household_documents")
        .select(_LIST_COLUMNS)
        .eq("household_id", household_id)
    ).order("created_at", desc=True).limit(limit).execute()
    return res.data or []


def search_documents(household_id: str, query: str, limit: int = 5) -> list[dict]:
    """Full-text search over title, summary, caption and the extracted text.

    `websearch` syntax so a plain phrase from a chat message ("school excursion
    fee") works as-is. Falls back to the most recent documents when the query
    is empty."""
    query = (query or "").strip()
    if not query:
        return recent_documents(household_id, limit)
    # text_search() returns a builder that can only execute(), so it has to be
    # the last call in the chain — the order/limit params are already on the
    # request by then, and PostgREST doesn't care about their order in the URL.
    res = _live(
        _db().table("household_documents")
        .select(_LIST_COLUMNS)
        .eq("household_id", household_id)
    ).order("created_at", desc=True).limit(limit).text_search(
        "search_tsv", query, options={"config": "simple", "type": "web_search"}
    ).execute()
    return res.data or []


def list_documents(household_id: str, query: str | None = None, limit: int = 50) -> list[dict]:
    if query and query.strip():
        return search_documents(household_id, query, limit)
    return recent_documents(household_id, limit)
