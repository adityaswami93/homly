"""conversation transcript per WhatsApp group (035_conversation_messages.sql)

Adds the conversation_messages table — the rolling per-group chat transcript
that gives the assistant short-term memory. Backs services/conversation.py,
which api/routers/internal.py reads before every graph invocation and writes
after it, and which services/whatsapp_client.py writes on every bot-initiated
send. See backend/migrations/035_conversation_messages.sql.

Revision ID: 035_conversation_messages
Revises: 034_bot_personality
Create Date: 2026-08-30T09:30:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '035_conversation_messages'
down_revision: Union[str, None] = '034_bot_personality'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '035_conversation_messages.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
