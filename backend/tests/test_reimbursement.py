"""
services/reimbursement.get_reimbursable() decides which receipts count as
reimbursable — the same rule the web upload path (services/receipt_service.py)
and the WhatsApp webhook path (api/routers/webhook.py) both call, so this
also acts as the regression guard for that DRY-ness: if this function's
behavior changes, both paths change together instead of drifting apart.
"""
from services.reimbursement import get_reimbursable


def test_mode_all_is_always_reimbursable():
    assert get_reimbursable("Alice", "+6591234567", {"reimbursement_mode": "all"}) is True
    assert get_reimbursable(None, None, {"reimbursement_mode": "all"}) is True


def test_mode_none_is_never_reimbursable():
    assert get_reimbursable("Alice", "+6591234567", {"reimbursement_mode": "none"}) is False


def test_default_mode_is_all_when_unset():
    assert get_reimbursable("Alice", None, {}) is True


def test_helpers_only_matches_by_name_case_insensitively():
    settings = {"reimbursement_mode": "helpers_only", "helper_identifiers": "Maria, +6598765432"}
    assert get_reimbursable("maria", None, settings) is True
    assert get_reimbursable("MARIA", None, settings) is True
    assert get_reimbursable("Someone Else", None, settings) is False


def test_helpers_only_matches_by_phone():
    settings = {"reimbursement_mode": "helpers_only", "helper_identifiers": "Maria, +6598765432"}
    assert get_reimbursable(None, "+6598765432", settings) is True
    assert get_reimbursable(None, "+6500000000", settings) is False


def test_helpers_only_with_no_identifiers_configured_is_never_reimbursable():
    settings = {"reimbursement_mode": "helpers_only", "helper_identifiers": ""}
    assert get_reimbursable("Maria", "+6598765432", settings) is False

    settings_missing_key = {"reimbursement_mode": "helpers_only"}
    assert get_reimbursable("Maria", "+6598765432", settings_missing_key) is False


def test_helpers_only_with_no_sender_info_is_never_reimbursable():
    settings = {"reimbursement_mode": "helpers_only", "helper_identifiers": "Maria"}
    assert get_reimbursable(None, None, settings) is False


def test_unknown_mode_falls_back_to_reimbursable():
    assert get_reimbursable("Alice", None, {"reimbursement_mode": "not-a-real-mode"}) is True
