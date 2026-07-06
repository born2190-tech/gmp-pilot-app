"""fg transfer notes (СОП-205 Ф-1 KAR-FP): цех → склад ГП карантин

Revision ID: 20260607_0048
Revises: 20260605_0047
Create Date: 2026-06-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260607_0048"
down_revision = "20260605_0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fg_transfer_notes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note_no", sa.String(length=64), nullable=False, unique=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="issued"),
        sa.Column("production_batch_id", UUID(as_uuid=True), sa.ForeignKey("production_batches.id"), nullable=False),
        sa.Column("product_code", sa.String(length=8), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("batch_no", sa.String(length=32), nullable=False),
        sa.Column("dosage_form", sa.String(length=128), nullable=True),
        sa.Column("production_date", sa.Date(), nullable=False),
        sa.Column("expiry_date", sa.Date(), nullable=False),
        sa.Column("from_workshop", sa.String(length=255), nullable=False),
        sa.Column("issued_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_warehouse_id", UUID(as_uuid=True), sa.ForeignKey("warehouses.id"), nullable=True),
        sa.Column("cancelled_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_table(
        "fg_transfer_note_lines",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note_id", UUID(as_uuid=True), sa.ForeignKey("fg_transfer_notes.id"), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=False, server_default="упак"),
        sa.Column("lot_id", UUID(as_uuid=True), sa.ForeignKey("lots.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("fg_transfer_note_lines")
    op.drop_table("fg_transfer_notes")
