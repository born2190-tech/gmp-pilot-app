"""product gtin + маркировка серии ГП (DataMatrix/ASL Belgisi, СОП-414 п.6.4)

Revision ID: 20260608_0051
Revises: 20260607_0050
Create Date: 2026-06-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260608_0051"
down_revision = "20260607_0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("gtin", sa.String(length=14), nullable=True))
    op.create_table(
        "fg_markings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("batch_no", sa.String(length=32), nullable=False, unique=True),
        sa.Column("production_batch_id", UUID(as_uuid=True), sa.ForeignKey("production_batches.id"), nullable=True),
        sa.Column("gtin", sa.String(length=14), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="applied"),
        sa.Column("report_id", sa.String(length=128), nullable=True),
        sa.Column("code_count", sa.Integer(), nullable=True),
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "fg_marking_sscc",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("marking_id", UUID(as_uuid=True), sa.ForeignKey("fg_markings.id"), nullable=False),
        sa.Column("sscc", sa.String(length=32), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("fg_marking_sscc")
    op.drop_table("fg_markings")
    op.drop_column("products", "gtin")
