"""Link production requisitions to production batches

Adds an optional production_batch_id FK so a material requisition (and its
FEFO issue) is tied to a concrete production batch (СОП-409 series), instead
of the free-text product_series only.

Revision ID: 20260530_0031
Revises: 20260530_0030
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260530_0031"
down_revision = "20260530_0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("production_requisitions", sa.Column("production_batch_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_production_requisitions_batch_id",
        "production_requisitions",
        "production_batches",
        ["production_batch_id"],
        ["id"],
    )
    op.create_index("ix_production_requisitions_batch_id", "production_requisitions", ["production_batch_id"])


def downgrade() -> None:
    op.drop_index("ix_production_requisitions_batch_id", table_name="production_requisitions")
    op.drop_constraint("fk_production_requisitions_batch_id", "production_requisitions", type_="foreignkey")
    op.drop_column("production_requisitions", "production_batch_id")
