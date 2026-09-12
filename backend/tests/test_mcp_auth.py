"""services/mcp_auth.py is the auth boundary for /mcp/data/* and the remote MCP
server, and had no test.

Two properties matter and neither is obvious from reading the three-line
functions: the plaintext must never be derivable from what gets stored, and the
prefix shown in the UI must be short enough to be useless on its own. A key
here is a bearer token for one household's entire financial history.
"""
from services.mcp_auth import KEY_PREFIX, SCOPE, generate_key, hash_key


def test_generated_key_carries_the_recognisable_prefix():
    plaintext, _hash, _display = generate_key()
    assert plaintext.startswith(KEY_PREFIX)


def test_stored_hash_round_trips_against_the_plaintext():
    # mcp_keys.py stores the hash at creation; mcp_data.py hashes the incoming
    # bearer token and looks it up. If these two ever disagreed, every key
    # would 403 immediately.
    plaintext, key_hash, _display = generate_key()
    assert hash_key(plaintext) == key_hash


def test_the_plaintext_is_not_recoverable_from_what_is_stored():
    plaintext, key_hash, display = generate_key()
    secret = plaintext[len(KEY_PREFIX):]
    assert secret not in key_hash
    assert secret not in display


def test_display_prefix_reveals_only_a_few_characters():
    # It exists to tell two keys apart in the UI, not to be usable.
    plaintext, _hash, display = generate_key()
    assert display == plaintext[: len(KEY_PREFIX) + 6]
    assert len(display) < len(plaintext)


def test_keys_are_unique_across_calls():
    keys = {generate_key()[0] for _ in range(100)}
    assert len(keys) == 100


def test_hash_is_stable_and_differs_between_keys():
    assert hash_key("homly_mcp_abc") == hash_key("homly_mcp_abc")
    assert hash_key("homly_mcp_abc") != hash_key("homly_mcp_abd")


def test_scope_is_the_value_the_api_keys_table_is_queried_by():
    # api_keys is a generic per-household key table; mcp_keys.py writes this
    # scope and mcp_data.py filters on it. Pinned so a rename breaks here
    # rather than silently returning 403 for every existing key.
    assert SCOPE == "mcp"
