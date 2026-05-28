"""Equipment registry (КИП) + калибровки + связь с QC report

Revision ID: 20260528_0023
Revises: 20260524_0022
Create Date: 2026-05-28
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260528_0023"
down_revision = "20260524_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "equipment",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=True),
        sa.Column("manufacturer", sa.String(length=255), nullable=True),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("serial_no", sa.String(length=128), nullable=True),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_equipment_is_active", "equipment", ["is_active"])
    op.create_index("ix_equipment_category", "equipment", ["category"])

    op.create_table(
        "equipment_calibrations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "equipment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("equipment.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("certificate_no", sa.String(length=128), nullable=True),
        sa.Column("performed_by", sa.String(length=255), nullable=True),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("recorded_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_equipment_calibrations_equipment_id",
        "equipment_calibrations",
        ["equipment_id"],
    )
    op.create_index(
        "ix_equipment_calibrations_valid_until",
        "equipment_calibrations",
        ["valid_until"],
    )

    op.create_table(
        "qc_report_equipment",
        sa.Column(
            "report_id",
            UUID(as_uuid=True),
            sa.ForeignKey("qc_reports.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "equipment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("equipment.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
    )

    op.add_column(
        "qc_report_parameters",
        sa.Column(
            "equipment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("equipment.id"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_qc_report_parameters_equipment_id",
        "qc_report_parameters",
        ["equipment_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_qc_report_parameters_equipment_id", table_name="qc_report_parameters")
    op.drop_column("qc_report_parameters", "equipment_id")
    op.drop_table("qc_report_equipment")
    op.drop_index("ix_equipment_calibrations_valid_until", table_name="equipment_calibrations")
    op.drop_index("ix_equipment_calibrations_equipment_id", table_name="equipment_calibrations")
    op.drop_table("equipment_calibrations")
    op.drop_index("ix_equipment_category", table_name="equipment")
    op.drop_index("ix_equipment_is_active", table_name="equipment")
    op.drop_table("equipment")
