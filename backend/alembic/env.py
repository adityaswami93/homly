"""Alembic environment for Homly.

Pure-SQL migrations, no ORM models — target_metadata stays None so
`alembic revision --autogenerate` is a no-op by design; every revision here
is written by hand (or generated once, for the pre-Alembic history) and
calls op.execute() directly, reading its own backend/migrations/*.sql file.
"""
import os
from logging.config import fileConfig

from dotenv import load_dotenv
from alembic import context
from sqlalchemy import engine_from_config, pool

# Alembic runs as its own standalone process, not through api/main.py's
# startup — nothing else loads backend/.env into this process, unlike every
# other entrypoint in this repo (api/main.py, the agents, mcp_server/server.py).
load_dotenv()

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def _database_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise RuntimeError(
            "SUPABASE_DB_URL is not set. Get it from the Supabase dashboard: "
            "Settings -> Database -> Connection string (direct, not pooled)."
        )
    # SQLAlchemy needs an explicit driver in the scheme to pick the psycopg3
    # dialect; Supabase's connection string is plain postgresql://.
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of executing it (`alembic upgrade --sql`)."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    cfg_section = config.get_section(config.config_ini_section, {})
    cfg_section["sqlalchemy.url"] = _database_url()
    connectable = engine_from_config(
        cfg_section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
