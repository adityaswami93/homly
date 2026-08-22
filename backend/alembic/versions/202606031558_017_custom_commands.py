"""custom commands (legacy migration 017_custom_commands.sql)

Wraps backend/migrations/017_custom_commands.sql verbatim -- see backend/migrations/README.md
for why the original .sql files are kept as the source of truth rather than
inlined here. This revision predates Alembic's adoption; it is baselined
(`alembic stamp`) on every existing database rather than re-executed.

Revision ID: 017_custom_commands
Revises: 017_insurance_document
Create Date: 2026-06-03T15:58:14+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '017_custom_commands'
down_revision: Union[str, None] = '017_insurance_document'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '017_custom_commands.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
