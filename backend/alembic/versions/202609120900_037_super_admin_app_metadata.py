"""super-admin flag moves to app_metadata (037_super_admin_app_metadata.sql)

Security fix. The flag lived in auth.users.raw_user_meta_data, which surfaces
in the JWT as `user_metadata` — the one metadata field Supabase lets a user
write to their own row (`auth.updateUser({ data: ... })`, anon key only). Any
registered user could therefore grant themselves super admin and read every
household's data through /admin/*. It now lives in raw_app_meta_data
(`app_metadata` in the JWT), which only the service role can write.

Deploy order matters: run this BEFORE the backend that reads `app_metadata`,
or during the gap super admins simply lose admin access — both old and new
code fail closed, so there is no window where the old claim still grants
anything. See documents/039-service-role-key-audit/release.md.

Revision ID: 037_super_admin_app_metadata
Revises: 036_waitlist_variant
Create Date: 2026-09-12T09:00:00+00:00
"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = '037_super_admin_app_metadata'
down_revision: Union[str, None] = '036_waitlist_variant'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_SQL = Path(__file__).resolve().parent.parent.parent / "migrations" / '037_super_admin_app_metadata.sql'


def upgrade() -> None:
    op.execute(_LEGACY_SQL.read_text())


def downgrade() -> None:
    raise NotImplementedError("Homly does not support downgrades — write a new forward migration instead")
