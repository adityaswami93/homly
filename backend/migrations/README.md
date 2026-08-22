# Migrations

Schema changes now run through **Alembic** (`backend/alembic/`), not by hand.

## Why this changed

Migrations used to be applied by pasting each `.sql` file into the Supabase
SQL editor, in filename order, with nothing recording what had actually run.
That broke down in two visible ways:

- **Numbering collisions with no way to detect them.** Four files are
  prefixed `016_`, two are prefixed `017_`, two are prefixed `029_` — nothing
  enforced uniqueness, so nothing caught it.
- **A real silent-failure bug.** `026_pantry_fridge_source.sql` rewrote the
  `pantry_items.added_by` CHECK constraint and dropped `'bot'` from the
  allowed set, while `pantry_agent.py` was still writing `added_by = 'bot'`
  on every WhatsApp-driven pantry update. Every one of those upserts violated
  the constraint and failed silently until `029_pantry_bot_source.sql`
  restored it. The bug wasn't bad SQL — it was nobody being able to answer
  "which constraint is actually live on this database?" without inspecting
  the schema directly.

Alembic's revision chain (each migration points at its literal parent) makes
the first problem structurally impossible. It doesn't prevent the second
kind of bug by itself, but the `schema_alembic_version` ledger it maintains
in the database is what makes "what's actually applied here?" an answerable
question again.

## What's here

- **`backend/migrations/*.sql`** — the original files, unchanged. Still the
  source of truth: each Alembic revision under `backend/alembic/versions/`
  for `001`–`029` is a thin wrapper that does nothing but
  `op.execute(Path("migrations/029_....sql").read_text())`. They're kept
  as plain `.sql` rather than inlined into the revision files so they stay
  individually readable (and still pastable into the SQL editor by hand as
  a fallback) instead of being buried in Python.
- **`backend/alembic/`** — the Alembic project: `env.py` (reads
  `SUPABASE_DB_URL`, translates it to the psycopg3 dialect SQLAlchemy
  needs), `versions/` (one file per revision), `script.py.mako` (template
  for new revisions — its `downgrade()` raises `NotImplementedError` by
  default, see below).
- **`030_pantry_pending_confirmations.sql`** is the first migration this
  project applies through Alembic rather than by hand.

## Adopting this on an existing database

Every database with `001`–`029` already applied (via the old manual
process) needs to be told that, without those migrations being re-run —
they're idempotent (`IF NOT EXISTS` etc.) so re-running is harmless, but
there's no reason to:

```bash
cd backend
alembic stamp 029_api_keys   # marks 001-029 as applied without executing them
alembic upgrade head          # actually runs 030 for the first time
```

A brand-new database (nothing applied yet) just runs everything:

```bash
cd backend
alembic upgrade head
```

Both commands need `SUPABASE_DB_URL` set. Use the **Session pooler**
connection string from Supabase dashboard → Connect, not the raw "Direct
connection" one — that hostname (`db.<ref>.supabase.co`) is IPv6-only, which
most networks (including a typical home Mac) can't resolve, and fails with
`nodename nor servname provided, or not known` rather than a connection
error. Session pooler is IPv4-reachable and, unlike **Transaction pooler**
(the other IPv4 option, port `6543`), gives you a dedicated connection for
the life of the run — Transaction pooler multiplexes across transactions and
drops the session-level state Alembic's advisory locking relies on, so it's
not a substitute here even though it also "works" for simple queries.

This is the same variable the LangGraph checkpointer already uses; see
`backend/.env.example`.

## Writing a new migration

```bash
cd backend
alembic revision -m "add reimbursement_mode to settings"
```

This creates a timestamped file in `alembic/versions/` — collisions are no
longer possible, because revisions chain by explicit parent pointer
(`down_revision`), not by filename number. Write the schema change as
`op.execute("""...""")`; there's no ORM here, so `--autogenerate` has
nothing to diff against and isn't used.

**Roll forward only.** `downgrade()` raises `NotImplementedError` in every
migration by default. Down-migrations mostly work in local dev and rarely
work correctly in production, once real data has changed underneath the
schema they'd be reverting. If a migration is wrong, write a new migration
that fixes it forward.

**Expand/contract for anything that removes or narrows a column, table, or
enum value.** Code and schema don't deploy atomically — during a rolling
deploy, old and new code run against the same database simultaneously. A
migration that narrows a CHECK constraint or drops a column has to be safe
for whatever the *currently running* code still writes or reads. The
`added_by = 'bot'` bug above is exactly what skipping this step looks like:
check what still writes a value before a migration stops allowing it.

## Applying in CI/deploy

Not yet wired into a deploy step — run `alembic upgrade head` manually
before deploying code that depends on a new migration. (Once this is
automated, it should run once before new code starts serving traffic, not
on every container's boot — running it per-replica on a rolling deploy
races multiple copies against the same advisory lock for no benefit.)
