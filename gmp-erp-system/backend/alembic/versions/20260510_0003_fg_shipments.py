"""finished goods shipment documents

Revision ID: 20260510_0003
Revises: 20260510_0002
Create Date: 2026-05-10
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260510_0003"
down_revision = "20260510_0002"
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
        "fg_shipment_documents",
        uuid_pk(),
        *timestamps(),
        sa.Column("document_no", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("customer_name", sa.String(length=255), nullable=False),
        sa.Column("customer_tax_id", sa.String(length=64), nullable=True),
        sa.Column("destination_address", sa.String(length=500), nullable=False),
        sa.Column("shipment_date", sa.Date(), nullable=False),
        sa.Column("vehicle_no", sa.String(length=64), nullable=True),
        sa.Column("waybill_no", sa.String(length=128), nullable=True),
        sa.Column("posted_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["posted_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_no"),
    )
    op.create_table(
        "fg_shipment_lines",
        uuid_pk(),
        *timestamps(),
        sa.Column("shipment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=False),
        sa.Column("quantity_after", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["lot_id"], ["lots.id"]),
        sa.ForeignKeyConstraint(["shipment_id"], ["fg_shipment_documents.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("fg_shipment_lines")
    op.drop_table("fg_shipment_documents")
