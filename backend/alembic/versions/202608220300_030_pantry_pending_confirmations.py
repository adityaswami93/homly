"""pantry pending confirmations (legacy migration 030_pantry_pending_confirmations.sql)

This is the first revision NOT baselined on an existing database — it was
merged in PR #60 but never actually applied (there was no runner yet; the
plan was to paste it into the Supabase SQL editor by hand). Running
`alembic upgrade head` after baselining 001-029 applies this one for real
and proves the new tool end-to-end in the same step. See
backend/migrations/README.md.

Revision ID: 030_pantry_pending_confirmations
Revises: 029_api_keys
Create Date: 2026-08-22T03:00:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '030_pantry_pending_confirmations'
down_revision: Union[str, None] = '029_api_keys'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '030_pantry_pending_confirmations.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
