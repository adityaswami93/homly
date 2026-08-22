"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: Union[str, None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    op.execute("""
    -- TODO: write the migration SQL
    """)


def downgrade() -> None:
    # Homly migrates roll-forward only (see backend/migrations/README.md) —
    # by the time a revert would be needed, real data has usually moved
    # underneath it. Write a new forward migration instead.
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
