"""Production batch draft/cancel lifecycle

Adds cancellation metadata to production_batches. The `draft` and `cancelled`
statuses reuse the existing `status` string column, so only the cancel
bookkeeping columns are added here.

Revision ID: 20260530_0030
Revises: 20260530_0029
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260530_0030"
down_revision = "20260530_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("production_batches", sa.Column("cancelled_by", UUID(as_uuid=True), nullable=True))
    op.add_column("production_batches", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("production_batches", sa.Column("cancel_reason", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_production_batches_cancelled_by_users",
        "production_batches",
        "users",
        ["cancelled_by"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_production_batches_cancelled_by_users", "production_batches", type_="foreignkey")
    op.drop_column("production_batches", "cancel_reason")
    op.drop_column("production_batches", "cancelled_at")
    op.drop_column("production_batches", "cancelled_by")
