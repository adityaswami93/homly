"""bot personality + engagement settings (033_bot_personality.sql)

Adds per-household assistant settings to the settings table: bot_name,
bot_engagement_mode, bot_tone, bot_casual_chat, bot_proactive_enabled. Backs
services/bot_profile.py, which is what agents/homly_graph.py,
agents/orchestrator/supervisor.py and agents/proactive_agent.py all read to
decide when the bot speaks and how it sounds. See
backend/migrations/033_bot_personality.sql.

Revision ID: 033_bot_personality
Revises: 032_household_preferences
Create Date: 2026-08-23T09:00:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '033_bot_personality'
down_revision: Union[str, None] = '032_household_preferences'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '033_bot_personality.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
