"""waitlist landing-page variant (036_waitlist_variant.sql)

Adds waitlist.variant so each signup records which landing-page hero it came
from. Written by api/routers/waitlist.py from the variant the frontend assigns
in frontend/app/page.tsx. Nullable — pre-existing rows and clients that omit it
stay valid. See backend/migrations/036_waitlist_variant.sql.

Chained after 035_conversation_messages rather than 034: both this and that
revision were written off 034 on separate branches, and leaving both pointing
there would give Alembic two heads and fail `alembic upgrade head`. The two
touch unrelated tables, so the order between them carries no meaning.

Revision ID: 036_waitlist_variant
Revises: 035_conversation_messages
Create Date: 2026-08-30T10:00:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '036_waitlist_variant'
down_revision: Union[str, None] = '035_conversation_messages'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '036_waitlist_variant.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
