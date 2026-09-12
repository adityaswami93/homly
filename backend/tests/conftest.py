"""Shared pytest fixtures.

The sys.path line below predates pytest.ini's `pythonpath = .` and is kept so a
single test module still runs when invoked from a different working directory.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402  (must follow the sys.path insert)

from tests.fakes import FakeSupabase  # noqa: E402


# Values that satisfy every module-scope client construction without reaching
# the network. `create_client` parses the URL but makes no request, and
# PyJWKClient fetches its keys lazily on first use — so importing the app is
# free as long as these are set to *something*. The frontend CI job already
# leans on the same trick for `next build`.
PLACEHOLDER_ENV = {
    "SUPABASE_URL": "https://placeholder.supabase.co",
    "SUPABASE_KEY": "placeholder-service-key",
    "OPENROUTER_API_KEY": "placeholder-openrouter-key",
    "INTERNAL_KEY": "placeholder-internal-key",
}


@pytest.fixture
def placeholder_env(monkeypatch):
    """Env vars needed to import anything that builds a Supabase client."""
    for key, value in PLACEHOLDER_ENV.items():
        monkeypatch.setenv(key, value)
    return PLACEHOLDER_ENV


@pytest.fixture
def fake_supabase(monkeypatch, placeholder_env):
    """Install a FakeSupabase as *the* client, before anything constructs a real one.

    This is the single hook that neutralises both client-acquisition patterns in
    the codebase at once, because both funnel through `services.db.get_supabase()`
    and it short-circuits on a populated `_client`:

      * module-level `supabase = get_supabase()` — api/middleware/auth.py,
        api/routers/{households,settings,insurance,mcp_keys,messages,savings,
        reimbursements,commands,reminders,waitlist,admin}.py. These run at *import*,
        so this fixture must win the race; see the seeding note below.
      * a lazy `_db()` accessor — api/routers/expenses.py and ~18 others.

    Seed rows with `fake_supabase.rows`, or request the `seeded_supabase` fixture.
    """
    import services.db as db

    fake = FakeSupabase()
    monkeypatch.setattr(db, "_client", fake, raising=False)

    # Modules imported *before* this fixture ran already hold a reference to
    # whatever get_supabase() returned then, so patching services.db alone would
    # miss them. Re-point any that are loaded; the ones not yet imported will
    # pick up the fake from services.db when they are.
    for module_name, attr in _MODULE_LEVEL_CLIENTS:
        module = sys.modules.get(module_name)
        if module is not None and hasattr(module, attr):
            monkeypatch.setattr(module, attr, fake)

    return fake


# (module, attribute) for every module that binds the client at import time.
# Grep for `= get_supabase()` at column 0 if this looks stale.
_MODULE_LEVEL_CLIENTS = [
    ("api.middleware.auth", "supabase"),
    ("api.routers.households", "supabase"),
    ("api.routers.messages", "supabase"),
    ("api.routers.savings", "supabase"),
    ("api.routers.insurance", "supabase"),
    ("api.routers.mcp_keys", "supabase"),
    ("api.routers.reimbursements", "supabase"),
    ("api.routers.commands", "supabase"),
    ("api.routers.settings", "supabase"),
    ("api.routers.reminders", "supabase"),
    ("api.routers.waitlist", "_supabase"),
    ("api.routers.admin", "supabase_client"),
]


@pytest.fixture
def api_client(fake_supabase):
    """A TestClient over the real app, with the fake DB installed.

    Deliberately NOT used as a context manager. Entering `with TestClient(app)`
    runs api/main.py's lifespan, which starts APScheduler and calls
    refresh_summaries() — background jobs and a Supabase read that no route test
    wants. Constructing it without the context manager skips lifespan entirely.
    """
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from api.main import app

    return TestClient(app)
