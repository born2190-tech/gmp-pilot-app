"""qc notification scans and lifecycle fields

Revision ID: 20260516_0009
Revises: 20260512_0008
Create Date: 2026-05-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260516_0009"
down_revision = "20260512_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "qc_notifications",
        sa.Column("printed_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "qc_notifications",
        sa.Column("printed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "qc_notifications",
        sa.Column("state_hash", sa.String(length=64), nullable=True),
    )
    op.create_foreign_key(
        "fk_qc_notifications_printed_by_users",
        "qc_notifications",
        "users",
        ["printed_by"],
        ["id"],
    )

    op.create_table(
        "qc_notification_scans",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notification_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("file_path", sa.String(length=512), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False, server_default="application/pdf"),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending_verification"),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("verified_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("signature_warehouse_ok", sa.Boolean(), nullable=True),
        sa.Column("signature_qc_ok", sa.Boolean(), nullable=True),
        sa.Column("signature_manager_ok", sa.Boolean(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["notification_id"], ["qc_notifications.id"]),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["verified_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_qc_notification_scans_notification_id",
        "qc_notification_scans",
        ["notification_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_qc_notification_scans_notification_id", table_name="qc_notification_scans")
    op.drop_table("qc_notification_scans")
    op.drop_constraint("fk_qc_notifications_printed_by_users", "qc_notifications", type_="foreignkey")
    op.drop_column("qc_notifications", "state_hash")
    op.drop_column("qc_notifications", "printed_at")
    op.drop_column("qc_notifications", "printed_by")
