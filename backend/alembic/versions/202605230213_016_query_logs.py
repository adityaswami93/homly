"""query logs (legacy migration 016_query_logs.sql)

Wraps backend/migrations/016_query_logs.sql verbatim -- see backend/migrations/README.md
for why the original .sql files are kept as the source of truth rather than
inlined here. This revision predates Alembic's adoption; it is baselined
(`alembic stamp`) on every existing database rather than re-executed.

Revision ID: 016_query_logs
Revises: 016_budgets
Create Date: 2026-05-23T02:13:52+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '016_query_logs'
down_revision: Union[str, None] = '016_budgets'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '016_query_logs.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
