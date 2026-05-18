"""add initial_quantity to lots for low-stock KPI

Revision ID: 20260517_0013
Revises: 20260517_0012
Create Date: 2026-05-17
"""

from alembic import op
import sqlalchemy as sa


revision = "20260517_0013"
down_revision = "20260517_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add nullable first so we can backfill in a separate UPDATE.
    op.add_column("lots", sa.Column("initial_quantity", sa.Float(), nullable=True))
    # Backfill: for historical lots, use the current quantity as the baseline.
    # That's a conservative default — the «мало остатков» KPI won't trigger
    # until the first issue from these lots, which matches the pilot expectation.
    op.execute("UPDATE lots SET initial_quantity = quantity WHERE initial_quantity IS NULL")
    op.alter_column("lots", "initial_quantity", nullable=False)


def downgrade() -> None:
    op.drop_column("lots", "initial_quantity")
