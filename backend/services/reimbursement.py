"""
Shared reimbursement-eligibility rule, used by both the /process-receipt API
path (web upload) and the WhatsApp bot webhook path so the two never disagree
on which receipts count as reimbursable.
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
