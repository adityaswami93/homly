"""recipe shopping (legacy migration 023_recipe_shopping.sql)

Wraps backend/migrations/023_recipe_shopping.sql verbatim -- see backend/migrations/README.md
for why the original .sql files are kept as the source of truth rather than
inlined here. This revision predates Alembic's adoption; it is baselined
(`alembic stamp`) on every existing database rather than re-executed.

Revision ID: 023_recipe_shopping
Revises: 022_backfill_price_history
Create Date: 2026-05-30T04:19:05+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '023_recipe_shopping'
down_revision: Union[str, None] = '022_backfill_price_history'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '023_recipe_shopping.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
