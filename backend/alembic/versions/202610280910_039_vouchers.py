"""vouchers and promo codes (039_vouchers.sql)

Adds the vouchers table and the private vouchers Storage bucket. Backs
services/vouchers.py. Depends on 038 (vouchers.document_id).

Revision ID: 039_vouchers
Revises: 038_household_documents
Create Date: 2026-10-28T09:10:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '039_vouchers'
down_revision: Union[str, None] = '038_household_documents'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '039_vouchers.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
