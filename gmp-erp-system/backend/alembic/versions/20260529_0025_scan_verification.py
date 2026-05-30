"""ДОК (QA) 4-eyes verification for Ф-10 (sampling) and Ф-11 (analytical) scans

Adds the same verification layer that qc_notification_scans (Ф-14) already has
to sampling_scans and qc_report_scans: status, verified_by/at, three wet-ink
signature confirmation flags and remarks.

Revision ID: 20260529_0025
Revises: 20260529_0024
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260529_0025"
down_revision = "20260529_0024"
branch_labels = None
depends_on = None

_TABLES = ("sampling_scans", "qc_report_scans")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column(
                "status",
                sa.String(length=32),
                nullable=False,
                server_default="pending_verification",
            ),
        )
        op.add_column(table, sa.Column("verified_by", UUID(as_uuid=True), nullable=True))
        op.add_column(table, sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
        op.add_column(table, sa.Column("signature_1_ok", sa.Boolean(), nullable=True))
        op.add_column(table, sa.Column("signature_2_ok", sa.Boolean(), nullable=True))
        op.add_column(table, sa.Column("signature_3_ok", sa.Boolean(), nullable=True))
        op.add_column(table, sa.Column("remarks", sa.Text(), nullable=True))
        op.create_foreign_key(
            f"fk_{table}_verified_by_users",
            table,
            "users",
            ["verified_by"],
            ["id"],
        )
        op.create_index(f"ix_{table}_status", table, ["status"])


def downgrade() -> None:
    for table in _TABLES:
        op.drop_index(f"ix_{table}_status", table_name=table)
        op.drop_constraint(f"fk_{table}_verified_by_users", table, type_="foreignkey")
        for col in (
            "remarks",
            "signature_3_ok",
            "signature_2_ok",
            "signature_1_ok",
            "verified_at",
            "verified_by",
            "status",
        ):
            op.drop_column(table, col)
