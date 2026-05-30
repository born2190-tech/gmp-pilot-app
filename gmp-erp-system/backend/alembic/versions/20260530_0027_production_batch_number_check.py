"""production batch number check gate

Revision ID: 20260530_0027
Revises: 20260530_0026
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260530_0027"
down_revision = "20260530_0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("production_batches", sa.Column("number_checked_by", UUID(as_uuid=True), nullable=True))
    op.add_column("production_batches", sa.Column("number_checked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_production_batches_number_checked_by_users",
        "production_batches",
        "users",
        ["number_checked_by"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_production_batches_number_checked_by_users", "production_batches", type_="foreignkey")
    op.drop_column("production_batches", "number_checked_at")
    op.drop_column("production_batches", "number_checked_by")
