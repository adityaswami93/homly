"""api keys (legacy migration 029_api_keys.sql)

Wraps backend/migrations/029_api_keys.sql verbatim -- see backend/migrations/README.md
for why the original .sql files are kept as the source of truth rather than
inlined here. This revision predates Alembic's adoption; it is baselined
(`alembic stamp`) on every existing database rather than re-executed.

Revision ID: 029_api_keys
Revises: 029_pantry_bot_source
Create Date: 2026-08-01T01:52:25+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '029_api_keys'
down_revision: Union[str, None] = '029_pantry_bot_source'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '029_api_keys.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
