"""Production batch BMR/ЗПС request step (СОП-11)

Production requests the BMR for an assigned series; QA (ДОК) prepares, reviews
and issues it. Adds the request bookkeeping columns. The legacy number_checked
columns stay (nullable, unused) to avoid a destructive migration.

Revision ID: 20260530_0032
Revises: 20260530_0031
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260530_0032"
down_revision = "20260530_0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("production_batches", sa.Column("bmr_requested_by", UUID(as_uuid=True), nullable=True))
    op.add_column("production_batches", sa.Column("bmr_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_production_batches_bmr_requested_by_users",
        "production_batches",
        "users",
        ["bmr_requested_by"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_production_batches_bmr_requested_by_users", "production_batches", type_="foreignkey")
    op.drop_column("production_batches", "bmr_requested_at")
    op.drop_column("production_batches", "bmr_requested_by")
