"""proactive notifications dedup log (031_proactive_notifications.sql)

Backs agents/proactive_agent.py's notify_household tool -- lets it check
whether a given finding_key was already surfaced to the household recently
before sending another WhatsApp message about it. See
backend/migrations/031_proactive_notifications.sql.

Revision ID: 031_proactive_notifications
Revises: 030_household_tasks
Create Date: 2026-08-22T10:30:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '031_proactive_notifications'
down_revision: Union[str, None] = '030_household_tasks'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '031_proactive_notifications.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
