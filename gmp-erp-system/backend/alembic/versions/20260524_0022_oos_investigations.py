"""OOS / РНС investigations (out-of-specification)

Revision ID: 20260524_0022
Revises: 20260524_0021
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260524_0022"
down_revision = "20260524_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oos_investigations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("number", sa.String(length=64), nullable=False, unique=True),
        sa.Column("report_id", UUID(as_uuid=True), sa.ForeignKey("qc_reports.id"), nullable=False),
        sa.Column("lot_id", UUID(as_uuid=True), sa.ForeignKey("lots.id"), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="open"),
        sa.Column("failed_summary", sa.Text(), nullable=True),
        sa.Column("root_cause", sa.Text(), nullable=True),
        sa.Column("conclusion", sa.Text(), nullable=True),
        sa.Column("disposition", sa.String(length=32), nullable=True),
        sa.Column("opened_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_oos_investigations_lot_id", "oos_investigations", ["lot_id"])
    op.create_index("ix_oos_investigations_status", "oos_investigations", ["status"])


def downgrade() -> None:
    op.drop_index("ix_oos_investigations_status", table_name="oos_investigations")
    op.drop_index("ix_oos_investigations_lot_id", table_name="oos_investigations")
    op.drop_table("oos_investigations")
