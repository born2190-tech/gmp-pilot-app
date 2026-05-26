"""zone-aware inventory accounts (quarantine/released) + material account group

Revision ID: 20260524_0021
Revises: 20260524_0020
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa


revision = "20260524_0021"
down_revision = "20260524_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inventory_accounts", sa.Column("zone", sa.String(length=16), nullable=True))
    op.add_column("materials", sa.Column("account_group", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("materials", "account_group")
    op.drop_column("inventory_accounts", "zone")
