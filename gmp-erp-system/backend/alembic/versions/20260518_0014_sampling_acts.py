"""sampling acts (СОП-533 / СОП-548 Ф-10)

Revision ID: 20260518_0014
Revises: 20260517_0013
Create Date: 2026-05-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260518_0014"
down_revision = "20260517_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sampling_acts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("act_no", sa.String(length=64), nullable=False, unique=True),
        sa.Column("lot_id", UUID(as_uuid=True), sa.ForeignKey("lots.id"), nullable=False),
        sa.Column("qc_notification_id", UUID(as_uuid=True), sa.ForeignKey("qc_notifications.id"), nullable=True),
        sa.Column("sop_form", sa.String(length=8), nullable=False, server_default="533"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("head_qc_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("warehouse_member_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("qc_representative_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("sampling_date", sa.Date(), nullable=True),
        sa.Column("sampling_location", sa.String(length=255), nullable=True),
        sa.Column("sample_condition", sa.String(length=255), nullable=True),
        sa.Column("temperature_c", sa.Float(), nullable=True),
        sa.Column("humidity_pct", sa.Float(), nullable=True),
        sa.Column("scale_model", sa.String(length=255), nullable=True),
        sa.Column("scale_calibration_no", sa.String(length=128), nullable=True),
        sa.Column("transport_with_ice", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("specification_ref", sa.String(length=255), nullable=True),
        sa.Column("registration_no", sa.String(length=128), nullable=True),
        sa.Column("containers_outer_total", sa.Integer(), nullable=True),
        sa.Column("containers_outer_sampled", sa.Integer(), nullable=True),
        sa.Column("containers_inner_total", sa.Integer(), nullable=True),
        sa.Column("containers_inner_sampled", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("posted_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sampling_acts_lot_id", "sampling_acts", ["lot_id"])
    op.create_index("ix_sampling_acts_status", "sampling_acts", ["status"])

    op.create_table(
        "sampling_lines",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sampling_act_id", UUID(as_uuid=True), sa.ForeignKey("sampling_acts.id"), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False, server_default="0"),
        sa.Column("unit", sa.String(length=32), nullable=False),
    )
    op.create_index("ix_sampling_lines_act_id", "sampling_lines", ["sampling_act_id"])

    op.create_table(
        "sampling_scans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sampling_act_id", UUID(as_uuid=True), sa.ForeignKey("sampling_acts.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("file_path", sa.String(length=512), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False, server_default="application/pdf"),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("uploaded_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sampling_scans_act_id", "sampling_scans", ["sampling_act_id"])


def downgrade() -> None:
    op.drop_index("ix_sampling_scans_act_id", table_name="sampling_scans")
    op.drop_table("sampling_scans")
    op.drop_index("ix_sampling_lines_act_id", table_name="sampling_lines")
    op.drop_table("sampling_lines")
    op.drop_index("ix_sampling_acts_status", table_name="sampling_acts")
    op.drop_index("ix_sampling_acts_lot_id", table_name="sampling_acts")
    op.drop_table("sampling_acts")
