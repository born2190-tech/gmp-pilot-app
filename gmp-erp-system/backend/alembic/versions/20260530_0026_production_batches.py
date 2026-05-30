"""production batch start workflow

Revision ID: 20260530_0026
Revises: 20260529_0025
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260530_0026"
down_revision = "20260529_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "production_batches",
        sa.Column("batch_no", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("product_code", sa.String(length=8), nullable=False),
        sa.Column("serial_no", sa.Integer(), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("dosage_form", sa.String(length=128), nullable=True),
        sa.Column("batch_size", sa.Float(), nullable=False),
        sa.Column("batch_size_unit", sa.String(length=32), nullable=False),
        sa.Column("production_date", sa.Date(), nullable=False),
        sa.Column("expiry_date", sa.Date(), nullable=False),
        sa.Column("shelf_life_months", sa.Integer(), nullable=False),
        sa.Column("bmr_no", sa.String(length=64), nullable=True),
        sa.Column("bmr_issued_by", UUID(as_uuid=True), nullable=True),
        sa.Column("bmr_issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("room_ready", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("equipment_ready", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("scales_checked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("materials_ready", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("qa_line_clearance", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("checklist_updated_by", UUID(as_uuid=True), nullable=True),
        sa.Column("checklist_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_by", UUID(as_uuid=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["bmr_issued_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["checklist_updated_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["started_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_no"),
        sa.UniqueConstraint("bmr_no"),
    )
    op.create_index("ix_production_batches_status", "production_batches", ["status"])
    op.create_index("ix_production_batches_product_year", "production_batches", ["product_code", "production_date"])


def downgrade() -> None:
    op.drop_index("ix_production_batches_product_year", table_name="production_batches")
    op.drop_index("ix_production_batches_status", table_name="production_batches")
    op.drop_table("production_batches")
