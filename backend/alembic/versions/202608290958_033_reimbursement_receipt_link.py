"""reimbursement receipt link (033_reimbursement_receipt_link.sql)

Makes each receipt's own `reimbursement_id` the single source of truth for
whether it has been paid, instead of matching `reimbursements` rows to
receipts by (year, week_number) -- see
backend/migrations/033_reimbursement_receipt_link.sql and
services/reimbursement.py's compute_reimbursement_totals()/
mark_receipts_reimbursed().

Revision ID: 033_reimbursement_receipt_link
Revises: 032_household_preferences
Create Date: 2026-08-29T09:58:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '033_reimbursement_receipt_link'
down_revision: Union[str, None] = '032_household_preferences'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '033_reimbursement_receipt_link.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
