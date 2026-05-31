"""users: личный PIN для построчных e-подписей BMR

Revision ID: 20260531_0038
Revises: 20260531_0037
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = "20260531_0038"
down_revision = "20260531_0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("signing_pin_hash", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "signing_pin_hash")
