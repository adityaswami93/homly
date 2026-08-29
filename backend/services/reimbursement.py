"""
Shared reimbursement rules and state, used by every path that reads or
writes reimbursement data (dashboard, WhatsApp bot webhook, WhatsApp chat
commands, weekly summary message) so they never disagree on which receipts
count as reimbursable or whether one has already been paid.
"""


def get_reimbursable(sender_name: str | None, sender_phone: str | None, settings: dict) -> bool:
    mode = settings.get("reimbursement_mode", "all")
    if mode == "all":
        return True
    if mode == "none":
        return False
    if mode == "helpers_only":
        identifiers = settings.get("helper_identifiers", "") or ""
        if not identifiers:
            return False
        helper_list = [h.strip().lower() for h in identifiers.split(",") if h.strip()]
        return bool(
            (sender_name and sender_name.lower() in helper_list)
            or (sender_phone and sender_phone in helper_list)
        )
    return True


def compute_reimbursement_totals(receipts: list[dict]) -> dict:
    """Single source of truth for how much of a set of receipts is
    reimbursable, already paid, and still outstanding.

    A receipt's own `reimbursement_id` is what decides whether it has been
    paid -- never a lookup against a separate ledger keyed by ISO week. That
    approach broke whenever a caller-supplied date range (e.g. a household's
    custom summary week) split receipts across two different ISO weeks: a
    payment recorded for one of those weeks got subtracted from receipts in
    an unrelated view that merely overlapped the same week number.
    """
    reimbursable = [r for r in receipts if r.get("reimbursable")]
    paid = round(sum((r["total"] or 0) for r in reimbursable if r.get("reimbursement_id")), 2)
    outstanding = round(sum((r["total"] or 0) for r in reimbursable if not r.get("reimbursement_id")), 2)
    return {
        "reimbursable_total": round(paid + outstanding, 2),
        "paid_reimbursable_total": paid,
        "outstanding_reimbursable_total": outstanding,
    }


def mark_receipts_reimbursed(
    db, household_id: str, receipts: list[dict], note: str | None, created_by: str | None = None
) -> dict | None:
    """Pay off every currently-unpaid reimbursable receipt in `receipts` with
    a single `reimbursements` row, then stamp that row's id onto each of
    those receipts via `receipts.reimbursement_id`.

    This is the only code path allowed to set `reimbursement_id` -- every
    caller that needs to mark receipts as paid (dashboard mark-as-paid,
    WhatsApp "paid" chat command, per-week reimbursements page) must go
    through here instead of inserting into `reimbursements` directly, so
    "is this receipt paid" always has one answer. `receipts` entries need
    `id`, `total`, `reimbursable`, `reimbursement_id`, and `date`.

    Returns None if nothing was outstanding (already paid, or none
    reimbursable), otherwise the created reimbursement row, the amount
    posted, and the receipt ids it covers.
    """
    unpaid = [r for r in receipts if r.get("reimbursable") and not r.get("reimbursement_id")]
    amount = round(sum((r["total"] or 0) for r in unpaid), 2)
    if amount <= 0:
        return None

    dates = [r["date"] for r in unpaid if r.get("date")]
    res = db.table("reimbursements").insert({
        "household_id": household_id,
        "amount":       amount,
        "note":         note,
        "created_by":   created_by,
        "start_date":   min(dates) if dates else None,
        "end_date":     max(dates) if dates else None,
    }).execute()
    reimbursement = res.data[0]

    db.table("receipts")\
        .update({"reimbursement_id": reimbursement["id"]})\
        .in_("id", [r["id"] for r in unpaid])\
        .execute()

    return {"reimbursement": reimbursement, "amount": amount, "receipt_ids": [r["id"] for r in unpaid]}
