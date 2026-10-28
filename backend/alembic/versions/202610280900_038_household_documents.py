"""photos the WhatsApp assistant read (038_household_documents.sql)

Adds household_documents -- photos the assistant read, stored with their
extracted text so they can be found in later conversations, plus the private
household-documents Storage bucket. Backs services/documents.py.

Revision ID: 038_household_documents
Revises: 037_super_admin_app_metadata
Create Date: 2026-10-28T09:00:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '038_household_documents'
down_revision: Union[str, None] = '037_super_admin_app_metadata'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '038_household_documents.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
