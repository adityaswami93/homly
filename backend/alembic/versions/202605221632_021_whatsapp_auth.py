"""whatsapp auth (legacy migration 021_whatsapp_auth.sql)

Wraps backend/migrations/021_whatsapp_auth.sql verbatim -- see backend/migrations/README.md
for why the original .sql files are kept as the source of truth rather than
inlined here. This revision predates Alembic's adoption; it is baselined
(`alembic stamp`) on every existing database rather than re-executed.

Revision ID: 021_whatsapp_auth
Revises: 020_household_profiles
Create Date: 2026-05-22T16:32:18+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '021_whatsapp_auth'
down_revision: Union[str, None] = '020_household_profiles'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '021_whatsapp_auth.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
