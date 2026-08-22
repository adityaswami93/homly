"""household preferences (032_household_preferences.sql)

Backs services/preferences.py and agents/query/preferences_agent.py -- lets
household members tell the bot standing preferences ("remember I don't eat
pork", "always remind us 2 weeks before renewals") that get folded into the
chat supervisor's and proactive monitor's system prompts on every run. See
backend/migrations/032_household_preferences.sql.

Revision ID: 032_household_preferences
Revises: 031_proactive_notifications
Create Date: 2026-08-22T11:30:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '032_household_preferences'
down_revision: Union[str, None] = '031_proactive_notifications'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '032_household_preferences.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
