"""add qc report documents

Revision ID: 20260510_0002
Revises: 20260510_0001
Create Date: 2026-05-10
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260510_0002"
down_revision = "20260510_0001"
branch_labels = None
depends_on = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def uuid_pk() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False)


def upgrade() -> None:
    op.create_table(
        "qc_reports",
        uuid_pk(),
        *timestamps(),
        sa.Column("lot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("report_no", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("method_reference", sa.String(length=255), nullable=True),
        sa.Column("analysis_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("analysis_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("overall_result", sa.String(length=32), nullable=True),
        sa.Column("submitted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["lot_id"], ["lots.id"]),
        sa.ForeignKeyConstraint(["submitted_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("report_no"),
    )
    op.create_table(
        "qc_report_parameters",
        uuid_pk(),
        *timestamps(),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parameter_name", sa.String(length=255), nullable=False),
        sa.Column("specification", sa.Text(), nullable=False),
        sa.Column("result_value", sa.Text(), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=True),
        sa.Column("method_reference", sa.String(length=255), nullable=True),
        sa.Column("complies", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["report_id"], ["qc_reports.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("qc_report_parameters")
    op.drop_table("qc_reports")
