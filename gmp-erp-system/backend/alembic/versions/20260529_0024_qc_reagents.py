"""QC reagents and reference standards registry

Revision ID: 20260529_0024
Revises: 20260528_0023
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260529_0024"
down_revision = "20260528_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "qc_reagents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("grade", sa.String(length=255), nullable=True),
        sa.Column("manufacturer", sa.String(length=255), nullable=True),
        sa.Column("supplier", sa.String(length=255), nullable=True),
        sa.Column("batch_number", sa.String(length=128), nullable=True),
        sa.Column("internal_batch_number", sa.String(length=128), nullable=False, unique=True),
        sa.Column("received_date", sa.Date(), nullable=False),
        sa.Column("opened_date", sa.Date(), nullable=True),
        sa.Column("expiry_date_unopened", sa.Date(), nullable=False),
        sa.Column("expiry_date_after_opening_days", sa.Integer(), nullable=False, server_default="365"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("unit", sa.String(length=32), nullable=False),
        sa.Column("storage_location", sa.String(length=255), nullable=True),
        sa.Column("storage_conditions", sa.String(length=255), nullable=True),
        sa.Column("responsible", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_qc_reagents_type", "qc_reagents", ["type"])
    op.create_index("ix_qc_reagents_status", "qc_reagents", ["status"])
    op.create_index("ix_qc_reagents_expiry", "qc_reagents", ["expiry_date_unopened"])

    op.create_table(
        "qc_reagent_movements",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reagent_id", UUID(as_uuid=True), sa.ForeignKey("qc_reagents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operation_type", sa.String(length=64), nullable=False),
        sa.Column("quantity_before", sa.Numeric(14, 4), nullable=False),
        sa.Column("quantity_operation", sa.Numeric(14, 4), nullable=False),
        sa.Column("quantity_after", sa.Numeric(14, 4), nullable=False),
        sa.Column("analytical_sheet", sa.String(length=128), nullable=True),
        sa.Column("material_batch", sa.String(length=128), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("signature_required", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("performed_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("performed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_qc_reagent_movements_reagent_id", "qc_reagent_movements", ["reagent_id"])
    op.create_index("ix_qc_reagent_movements_performed_at", "qc_reagent_movements", ["performed_at"])

    op.create_table(
        "qc_reagent_certificates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reagent_id", UUID(as_uuid=True), sa.ForeignKey("qc_reagents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("certificate_no", sa.String(length=128), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("uploaded_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_qc_reagent_certificates_reagent_id", "qc_reagent_certificates", ["reagent_id"])


def downgrade() -> None:
    op.drop_index("ix_qc_reagent_certificates_reagent_id", table_name="qc_reagent_certificates")
    op.drop_table("qc_reagent_certificates")
    op.drop_index("ix_qc_reagent_movements_performed_at", table_name="qc_reagent_movements")
    op.drop_index("ix_qc_reagent_movements_reagent_id", table_name="qc_reagent_movements")
    op.drop_table("qc_reagent_movements")
    op.drop_index("ix_qc_reagents_expiry", table_name="qc_reagents")
    op.drop_index("ix_qc_reagents_status", table_name="qc_reagents")
    op.drop_index("ix_qc_reagents_type", table_name="qc_reagents")
    op.drop_table("qc_reagents")
