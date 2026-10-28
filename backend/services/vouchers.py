"""Vouchers and promo codes — the single home for their business rules.

Every way a voucher gets in (dashboard form, dashboard upload, a voucher photo
in the WhatsApp group, a pasted promo message, "save it as a voucher" after the
assistant read a photo) goes through create_voucher(); every way one is shown
(dashboard, chat agent, proactive monitor) goes through decorate(). That is
what keeps "is this still usable?" one rule instead of four.

The rules that live here and nowhere else:

  * "Expired" is derived, never stored: a voucher whose expires_at is before
    today *in the household's timezone* (services/household_time.py). The
    stored status is only ever active / used / archived.
  * The same code for the same merchant is the same voucher (case-insensitive)
    — forwarding a promo into the group twice doesn't make two.
  * One-time use: marking used is final for the wallet (it moves to history).
    There is no running balance; gift cards with balances are out of scope.

RLS is disabled on `vouchers` — every query below filters by household_id.
"""
import logging
from datetime import date, datetime, timezone as tz
from decimal import Decimal, InvalidOperation

from services.db import get_supabase
from services.household_time import household_today

logger = logging.getLogger(__name__)

BUCKET = "vouchers"

KINDS = ("promo_code", "voucher", "cashback", "other")
VALUE_TYPES = ("amount", "percent", "freebie", "other")
SOURCES = ("dashboard", "whatsapp", "document")

# Within this many days of its expiry a voucher is flagged "expiring soon" —
# on the wallet page and for the proactive monitor's nudge.
EXPIRING_SOON_DAYS = 7

_EDITABLE = (
    "merchant", "title", "code", "kind", "value_type", "value", "currency",
    "min_spend", "terms", "expires_at",
)


def _db():
    return get_supabase()


# ── Normalisation ─────────────────────────────────────────────────────────────


def _clean_str(value, limit: int = 500) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s[:limit] or None


def _clean_number(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        n = Decimal(str(value).replace(",", "").replace("$", "").strip())
    except (InvalidOperation, ValueError):
        return None
    if n < 0:
        return None
    return float(round(n, 2))


def _clean_date(value) -> str | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    try:
        return date.fromisoformat(str(value).strip()[:10]).isoformat()
    except ValueError:
        return None


def normalize(data: dict) -> dict:
    """Coerce whatever a caller (a form, an LLM extraction) handed over into
    column values. Unknown enums fall back rather than failing the insert —
    an LLM saying kind="coupon" shouldn't lose the voucher."""
    out = {
        "merchant": _clean_str(data.get("merchant"), 120),
        "title": _clean_str(data.get("title"), 200),
        # Codes are kept exactly as printed apart from surrounding whitespace —
        # some merchants' codes are case-sensitive.
        "code": _clean_str(data.get("code"), 120),
        "kind": data.get("kind") if data.get("kind") in KINDS else None,
        "value_type": data.get("value_type") if data.get("value_type") in VALUE_TYPES else None,
        "value": _clean_number(data.get("value")),
        "currency": (_clean_str(data.get("currency"), 8) or "").upper() or None,
        "min_spend": _clean_number(data.get("min_spend")),
        "terms": _clean_str(data.get("terms"), 2000),
        "expires_at": _clean_date(data.get("expires_at")),
    }
    if out["code"]:
        out["code"] = " ".join(out["code"].split())
    if out["kind"] is None:
        out["kind"] = "promo_code" if out["code"] else "voucher"
    return out


# ── Derived state ─────────────────────────────────────────────────────────────


def effective_status(row: dict, today: date) -> str:
    status = row.get("status") or "active"
    if status != "active":
        return status
    exp = _clean_date(row.get("expires_at"))
    if exp and date.fromisoformat(exp) < today:
        return "expired"
    return "active"


def days_left(row: dict, today: date) -> int | None:
    exp = _clean_date(row.get("expires_at"))
    if not exp:
        return None
    return (date.fromisoformat(exp) - today).days


def decorate(row: dict, today: date) -> dict:
    """The row plus everything a reader needs that isn't stored — so the
    dashboard and the chat agent show the same thing without recomputing it."""
    status = effective_status(row, today)
    left = days_left(row, today)
    return {
        **row,
        "effective_status": status,
        "days_left": left,
        "expiring_soon": status == "active" and left is not None and left <= EXPIRING_SOON_DAYS,
        "value_label": value_label(row),
    }


def value_label(row: dict) -> str | None:
    value = row.get("value")
    vt = row.get("value_type")
    if vt == "percent" and value is not None:
        label = f"{float(value):g}% off"
    elif vt == "amount" and value is not None:
        cur = row.get("currency") or ""
        label = f"{cur + ' ' if cur else '$'}{float(value):,.2f}".replace(".00", "") + " off"
    elif vt == "freebie":
        label = "Free item"
    else:
        return None
    if row.get("min_spend"):
        label += f" (min spend {float(row['min_spend']):g})"
    return label


def describe(row: dict) -> str:
    """One WhatsApp line for a voucher."""
    parts = [f"*{row.get('merchant') or 'Voucher'}*"]
    label = row.get("value_label") or value_label(row) or row.get("title")
    if label:
        parts.append(label)
    parts.append(f"code `{row['code']}`" if row.get("code") else "show the barcode/QR (in the dashboard)")
    left = row.get("days_left")
    if row.get("expires_at"):
        d = date.fromisoformat(_clean_date(row["expires_at"]))
        exp = f"{d.day} {d.strftime('%b %Y')}"
        if left is not None and 0 <= left <= EXPIRING_SOON_DAYS:
            when = "today" if left == 0 else ("tomorrow" if left == 1 else f"in {left} days")
            parts.append(f"expires {exp} ⏳ ({when})")
        else:
            parts.append(f"expires {exp}")
    return " · ".join(parts)


# ── Reading ───────────────────────────────────────────────────────────────────


def _fetch(household_id: str) -> list[dict]:
    res = (
        _db().table("vouchers")
        .select("*")
        .eq("household_id", household_id)
        .order("expires_at", desc=False, nullsfirst=False)
        .execute()
    )
    return res.data or []


def list_vouchers(household_id: str, status: str = "active") -> list[dict]:
    """status: active (usable now), used, expired, archived, history (used +
    expired + archived), or all. Active ones come soonest-expiring first."""
    today = household_today(household_id)
    rows = [decorate(r, today) for r in _fetch(household_id)]
    if status == "all":
        return rows
    if status == "history":
        return sorted(
            (r for r in rows if r["effective_status"] != "active"),
            key=lambda r: r.get("used_at") or r.get("expires_at") or r.get("created_at") or "",
            reverse=True,
        )
    return [r for r in rows if r["effective_status"] == status]


def get_voucher(household_id: str, voucher_id: str) -> dict | None:
    res = (
        _db().table("vouchers").select("*")
        .eq("household_id", household_id).eq("id", voucher_id)
        .limit(1).execute()
    )
    rows = res.data or []
    if not rows:
        return None
    return decorate(rows[0], household_today(household_id))


def _matches_merchant(row: dict, merchant: str) -> bool:
    a = (row.get("merchant") or "").lower()
    b = merchant.lower().strip()
    return bool(b) and (b in a or a in b)


def find_vouchers(household_id: str, merchant: str | None = None, code: str | None = None,
                  status: str = "active") -> list[dict]:
    rows = list_vouchers(household_id, status)
    if code:
        c = code.strip().lower()
        rows = [r for r in rows if (r.get("code") or "").lower() == c]
    if merchant:
        rows = [r for r in rows if _matches_merchant(r, merchant)]
    return rows


def expiring_soon(household_id: str, within_days: int = EXPIRING_SOON_DAYS) -> list[dict]:
    return [
        r for r in list_vouchers(household_id, "active")
        if r["days_left"] is not None and r["days_left"] <= within_days
    ]


# ── Writing ───────────────────────────────────────────────────────────────────


def _existing_duplicate(household_id: str, merchant: str, code: str | None,
                        whatsapp_message_id: str | None = None) -> dict | None:
    """The voucher this one would duplicate: same merchant + code, or the same
    WhatsApp message delivered twice. A household holds tens of vouchers, not
    thousands, so comparing in Python keeps the case-insensitive match exact
    (an ilike pattern would treat a code's "_" or "%" as a wildcard)."""
    if not code and not whatsapp_message_id:
        return None
    for r in _fetch(household_id):
        if whatsapp_message_id and r.get("whatsapp_message_id") == whatsapp_message_id:
            return r
        if (code and (r.get("code") or "").lower() == code.lower()
                and (r.get("merchant") or "").lower() == merchant.lower()):
            return r
    return None


def create_voucher(
    household_id: str,
    data: dict,
    *,
    source: str = "dashboard",
    image_path: str | None = None,
    document_id: str | None = None,
    confidence: str | None = None,
    added_by_name: str | None = None,
    added_by_phone: str | None = None,
    created_by: str | None = None,
    whatsapp_message_id: str | None = None,
) -> tuple[dict | None, bool, str | None]:
    """Insert a voucher. Returns (row, created, error).

    `created` is False when the same merchant+code was already saved — the
    existing row is returned so the caller can say "already have that one"
    instead of erroring. `error` is a user-presentable reason when nothing
    could be saved (no merchant, no code and no image, DB failure)."""
    clean = normalize(data)
    if not clean["merchant"]:
        return None, False, "I couldn't tell which shop or brand the voucher is for."
    if not clean["code"] and not image_path:
        return None, False, "There's no code to save, and no image of the voucher to fall back on."

    today = household_today(household_id)
    dup = _existing_duplicate(household_id, clean["merchant"], clean["code"], whatsapp_message_id)
    if dup:
        return decorate(dup, today), False, None

    row = {
        **clean,
        "household_id": household_id,
        "status": "active",
        "source": source if source in SOURCES else "dashboard",
        "image_path": image_path,
        "document_id": document_id,
        "confidence": confidence if confidence in ("high", "medium", "low") else None,
        "added_by_name": added_by_name,
        "added_by_phone": added_by_phone,
        "created_by": created_by,
        "whatsapp_message_id": whatsapp_message_id,
    }
    try:
        res = _db().table("vouchers").insert(row).execute()
    except Exception as e:
        # A race with the same code (unique index) or a WhatsApp redelivery
        # (unique whatsapp_message_id) lands here — return what's there.
        dup = _existing_duplicate(household_id, clean["merchant"], clean["code"], whatsapp_message_id)
        if dup:
            return decorate(dup, today), False, None
        logger.error(f"[vouchers] insert failed for household {household_id}: {e}")
        return None, False, "Something went wrong saving it — please try again."
    saved = (res.data or [None])[0]
    return (decorate(saved, today) if saved else None), bool(saved), None


def update_voucher(household_id: str, voucher_id: str, data: dict) -> dict | None:
    clean = normalize({**data})
    patch = {k: clean[k] for k in _EDITABLE if k in data}
    if "merchant" in patch and not patch["merchant"]:
        raise ValueError("merchant cannot be empty")
    if "status" in data:
        if data["status"] not in ("active", "used", "archived"):
            raise ValueError("status must be active, used or archived")
        patch["status"] = data["status"]
        if data["status"] == "active":
            patch["used_at"] = None
            patch["used_by_name"] = None
        elif data["status"] == "used":
            patch["used_at"] = datetime.now(tz.utc).isoformat()
    if not patch:
        return get_voucher(household_id, voucher_id)
    patch["updated_at"] = datetime.now(tz.utc).isoformat()
    res = (
        _db().table("vouchers").update(patch)
        .eq("household_id", household_id).eq("id", voucher_id)
        .execute()
    )
    rows = res.data or []
    return decorate(rows[0], household_today(household_id)) if rows else None


def mark_used(household_id: str, voucher_id: str, used_by_name: str | None = None) -> dict | None:
    now = datetime.now(tz.utc).isoformat()
    res = (
        _db().table("vouchers")
        .update({"status": "used", "used_at": now, "used_by_name": used_by_name, "updated_at": now})
        .eq("household_id", household_id).eq("id", voucher_id)
        .execute()
    )
    rows = res.data or []
    return decorate(rows[0], household_today(household_id)) if rows else None


def delete_voucher(household_id: str, voucher_id: str) -> bool:
    existing = get_voucher(household_id, voucher_id)
    if not existing:
        return False
    _db().table("vouchers").delete().eq("household_id", household_id).eq("id", voucher_id).execute()
    if existing.get("image_path"):
        discard_image(existing["image_path"])
    return True


def discard_image(path: str) -> None:
    """Remove an image uploaded for a voucher that turned out to be a duplicate."""
    try:
        _db().storage.from_(BUCKET).remove([path])
    except Exception as e:
        logger.warning(f"[vouchers] could not remove image {path}: {e}")
