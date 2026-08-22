"""savings accounts (legacy migration 028_savings_accounts.sql)

Wraps backend/migrations/028_savings_accounts.sql verbatim -- see backend/migrations/README.md
for why the original .sql files are kept as the source of truth rather than
inlined here. This revision predates Alembic's adoption; it is baselined
(`alembic stamp`) on every existing database rather than re-executed.

Revision ID: 028_savings_accounts
Revises: 027_household_currency
Create Date: 2026-07-08T14:13:33+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '028_savings_accounts'
down_revision: Union[str, None] = '027_household_currency'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '028_savings_accounts.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
