"""household currency (legacy migration 027_household_currency.sql)

Wraps backend/migrations/027_household_currency.sql verbatim -- see backend/migrations/README.md
for why the original .sql files are kept as the source of truth rather than
inlined here. This revision predates Alembic's adoption; it is baselined
(`alembic stamp`) on every existing database rather than re-executed.

Revision ID: 027_household_currency
Revises: 026_pantry_fridge_source
Create Date: 2026-07-08T14:13:33+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '027_household_currency'
down_revision: Union[str, None] = '026_pantry_fridge_source'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '027_household_currency.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
