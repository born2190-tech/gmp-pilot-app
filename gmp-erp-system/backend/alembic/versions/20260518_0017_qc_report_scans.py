"""scanned analytical sheet attachments for QC reports

Revision ID: 20260518_0017
Revises: 20260518_0016
Create Date: 2026-05-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260518_0017"
down_revision = "20260518_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "qc_report_scans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("report_id", UUID(as_uuid=True), sa.ForeignKey("qc_reports.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("file_path", sa.String(length=512), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False, server_default="application/pdf"),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("uploaded_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_qc_report_scans_report_id", "qc_report_scans", ["report_id"])


def downgrade() -> None:
    op.drop_index("ix_qc_report_scans_report_id", table_name="qc_report_scans")
    op.drop_table("qc_report_scans")
