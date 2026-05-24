"""QC analysis workspace: param category + analysis-header & micro fields

Revision ID: 20260524_0018
Revises: 20260518_0017
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa


revision = "20260524_0018"
down_revision = "20260518_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Раздел параметра: ФХ или микро (СОП-514).
    op.add_column(
        "qc_report_parameters",
        sa.Column("category", sa.String(length=20), nullable=False, server_default="physicochemical"),
    )
    # Условия проведения анализа + микробиологический блок в шапке протокола.
    op.add_column("qc_reports", sa.Column("equipment", sa.Text(), nullable=True))
    op.add_column("qc_reports", sa.Column("room_temp", sa.String(length=32), nullable=True))
    op.add_column("qc_reports", sa.Column("humidity", sa.String(length=32), nullable=True))
    op.add_column(
        "qc_reports",
        sa.Column("micro_required", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column("qc_reports", sa.Column("micro_method_reference", sa.String(length=255), nullable=True))
    op.add_column("qc_reports", sa.Column("micro_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("qc_reports", sa.Column("micro_finished_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("qc_reports", "micro_finished_at")
    op.drop_column("qc_reports", "micro_started_at")
    op.drop_column("qc_reports", "micro_method_reference")
    op.drop_column("qc_reports", "micro_required")
    op.drop_column("qc_reports", "humidity")
    op.drop_column("qc_reports", "room_temp")
    op.drop_column("qc_reports", "equipment")
    op.drop_column("qc_report_parameters", "category")
