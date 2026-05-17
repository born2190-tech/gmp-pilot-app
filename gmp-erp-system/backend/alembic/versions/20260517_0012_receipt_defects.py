"""receipt defects (СОП-209 Ф-12)

Revision ID: 20260517_0012
Revises: 20260516_0011
Create Date: 2026-05-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260517_0012"
down_revision = "20260516_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "receipt_defects",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("act_no", sa.String(length=64), nullable=False),
        sa.Column("receipt_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("receipt_line_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("recorded_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_comment", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["receipt_id"], ["receipt_documents.id"]),
        sa.ForeignKeyConstraint(["receipt_line_id"], ["receipt_lines.id"]),
        sa.ForeignKeyConstraint(["recorded_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("act_no"),
    )
    op.create_index("ix_receipt_defects_receipt_id", "receipt_defects", ["receipt_id"])
    op.create_index("ix_receipt_defects_severity", "receipt_defects", ["severity"])

    op.create_table(
        "receipt_defect_photos",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("defect_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_path", sa.String(length=512), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["defect_id"], ["receipt_defects.id"]),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_receipt_defect_photos_defect_id", "receipt_defect_photos", ["defect_id"])


def downgrade() -> None:
    op.drop_index("ix_receipt_defect_photos_defect_id", table_name="receipt_defect_photos")
    op.drop_table("receipt_defect_photos")
    op.drop_index("ix_receipt_defects_severity", table_name="receipt_defects")
    op.drop_index("ix_receipt_defects_receipt_id", table_name="receipt_defects")
    op.drop_table("receipt_defects")
