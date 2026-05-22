"""manufacturer CoA at receipt (substances)

Revision ID: 20260518_0016
Revises: 20260518_0015
Create Date: 2026-05-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260518_0016"
down_revision = "20260518_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "receipt_certificates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("receipt_id", UUID(as_uuid=True), sa.ForeignKey("receipt_documents.id"), nullable=False),
        sa.Column("receipt_line_id", UUID(as_uuid=True), sa.ForeignKey("receipt_lines.id"), nullable=True),
        sa.Column("certificate_no", sa.String(length=128), nullable=True),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column("file_path", sa.String(length=512), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("uploaded_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_receipt_certificates_receipt_id", "receipt_certificates", ["receipt_id"])


def downgrade() -> None:
    op.drop_index("ix_receipt_certificates_receipt_id", table_name="receipt_certificates")
    op.drop_table("receipt_certificates")
