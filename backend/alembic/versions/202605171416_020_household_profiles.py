"""household profiles (legacy migration 020_household_profiles.sql)

Wraps backend/migrations/020_household_profiles.sql verbatim -- see backend/migrations/README.md
for why the original .sql files are kept as the source of truth rather than
inlined here. This revision predates Alembic's adoption; it is baselined
(`alembic stamp`) on every existing database rather than re-executed.

Revision ID: 020_household_profiles
Revises: 019_whatsapp_sessions
Create Date: 2026-05-17T14:16:36+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '020_household_profiles'
down_revision: Union[str, None] = '019_whatsapp_sessions'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '020_household_profiles.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
