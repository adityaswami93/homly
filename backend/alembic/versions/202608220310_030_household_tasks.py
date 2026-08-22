"""household tasks (legacy migration 030_household_tasks.sql)

Merged from the household-tasks branch, which predated the Alembic runner, so
this .sql may already have been applied by hand on some databases. Every
statement in it is idempotent (CREATE ... IF NOT EXISTS, DROP CONSTRAINT IF
EXISTS), so re-running it through Alembic is a no-op there.

Revision ID: 030_household_tasks
Revises: 030_pantry_pending_confirmations
Create Date: 2026-08-22T03:10:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '030_household_tasks'
down_revision: Union[str, None] = '030_pantry_pending_confirmations'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '030_household_tasks.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
