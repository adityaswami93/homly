"""waitlist landing-page variant (035_waitlist_variant.sql)

Adds waitlist.variant so each signup records which landing-page hero it came
from. Written by api/routers/waitlist.py from the variant the frontend assigns
in frontend/app/page.tsx. Nullable — pre-existing rows and clients that omit it
stay valid. See backend/migrations/035_waitlist_variant.sql.

Revision ID: 035_waitlist_variant
Revises: 034_bot_personality
Create Date: 2026-08-30T06:30:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '035_waitlist_variant'
down_revision: Union[str, None] = '034_bot_personality'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '035_waitlist_variant.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
