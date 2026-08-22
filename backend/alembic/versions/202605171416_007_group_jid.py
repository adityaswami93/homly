"""group jid (legacy migration 007_group_jid.sql)

Wraps backend/migrations/007_group_jid.sql verbatim -- see backend/migrations/README.md
for why the original .sql files are kept as the source of truth rather than
inlined here. This revision predates Alembic's adoption; it is baselined
(`alembic stamp`) on every existing database rather than re-executed.

Revision ID: 007_group_jid
Revises: 006_multi_tenant
Create Date: 2026-05-17T14:16:36+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '007_group_jid'
down_revision: Union[str, None] = '006_multi_tenant'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '007_group_jid.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
