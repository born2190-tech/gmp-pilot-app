"""inventory count wave with 4-eyes workflow

Revision ID: 20260516_0011
Revises: 20260516_0010
Create Date: 2026-05-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260516_0011"
down_revision = "20260516_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_count_waves",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("wave_no", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("warehouse_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scope_description", sa.String(length=255), nullable=False),
        sa.Column("tolerance_pct", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("counters", sa.String(length=500), nullable=True),
        sa.Column("verifier_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("posted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["verifier_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["posted_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("wave_no"),
    )
    op.create_index("ix_inventory_count_waves_status", "inventory_count_waves", ["status"])

    op.create_table(
        "inventory_count_wave_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("wave_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("system_quantity", sa.Float(), nullable=False),
        sa.Column("actual_quantity", sa.Float(), nullable=True),
        sa.Column("variance", sa.Float(), nullable=True),
        sa.Column("variance_pct", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(length=32), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("counted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("counted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verifier_comment", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["wave_id"], ["inventory_count_waves.id"]),
        sa.ForeignKeyConstraint(["lot_id"], ["lots.id"]),
        sa.ForeignKeyConstraint(["counted_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["verified_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_inventory_count_wave_lines_wave_id",
        "inventory_count_wave_lines",
        ["wave_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_inventory_count_wave_lines_wave_id", table_name="inventory_count_wave_lines")
    op.drop_table("inventory_count_wave_lines")
    op.drop_index("ix_inventory_count_waves_status", table_name="inventory_count_waves")
    op.drop_table("inventory_count_waves")
