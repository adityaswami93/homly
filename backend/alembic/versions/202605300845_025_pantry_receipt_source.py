"""pantry receipt source (legacy migration 025_pantry_receipt_source.sql)

Wraps backend/migrations/025_pantry_receipt_source.sql verbatim -- see backend/migrations/README.md
for why the original .sql files are kept as the source of truth rather than
inlined here. This revision predates Alembic's adoption; it is baselined
(`alembic stamp`) on every existing database rather than re-executed.

Revision ID: 025_pantry_receipt_source
Revises: 024_pantry
Create Date: 2026-05-30T08:45:59+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '025_pantry_receipt_source'
down_revision: Union[str, None] = '024_pantry'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '025_pantry_receipt_source.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
