"""production batch completion gate

Revision ID: 20260530_0028
Revises: 20260530_0027
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa


revision = "20260530_0028"
down_revision = "20260530_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("production_batches", sa.Column("completed_by", sa.UUID(), nullable=True))
    op.add_column("production_batches", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_production_batches_completed_by_users",
        "production_batches",
        "users",
        ["completed_by"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_production_batches_completed_by_users", "production_batches", type_="foreignkey")
    op.drop_column("production_batches", "completed_at")
    op.drop_column("production_batches", "completed_by")
