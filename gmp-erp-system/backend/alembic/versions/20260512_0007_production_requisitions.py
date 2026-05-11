"""production requisitions with FEFO allocation

Revision ID: 20260512_0007
Revises: 20260511_0006
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260512_0007"
down_revision = "20260511_0006"
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
        "production_requisitions",
        uuid_pk(),
        *timestamps(),
        sa.Column("requisition_no", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("product_series", sa.String(length=128), nullable=True),
        sa.Column("production_date", sa.Date(), nullable=True),
        sa.Column("production_order_no", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column("submitted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["submitted_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("requisition_no"),
    )

    op.create_table(
        "requisition_lines",
        uuid_pk(),
        *timestamps(),
        sa.Column("requisition_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("material_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requested_quantity", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=False),
        sa.Column("warehouse_type", sa.String(length=64), nullable=False),
        sa.Column("issued_quantity", sa.Float(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"]),
        sa.ForeignKeyConstraint(["requisition_id"], ["production_requisitions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "requisition_allocation_lines",
        uuid_pk(),
        *timestamps(),
        sa.Column("requisition_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requisition_line_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("warehouse_type", sa.String(length=64), nullable=False),
        sa.Column("allocated_quantity", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("issued_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["issued_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["lot_id"], ["lots.id"]),
        sa.ForeignKeyConstraint(["requisition_id"], ["production_requisitions.id"]),
        sa.ForeignKeyConstraint(["requisition_line_id"], ["requisition_lines.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # Indexes for common query patterns
    op.create_index("ix_prod_req_status", "production_requisitions", ["status"])
    op.create_index("ix_req_lines_req_id", "requisition_lines", ["requisition_id"])
    op.create_index("ix_req_alloc_req_id", "requisition_allocation_lines", ["requisition_id"])
    op.create_index("ix_req_alloc_line_id", "requisition_allocation_lines", ["requisition_line_id"])
    op.create_index("ix_req_alloc_status", "requisition_allocation_lines", ["status"])


def downgrade() -> None:
    op.drop_index("ix_req_alloc_status", "requisition_allocation_lines")
    op.drop_index("ix_req_alloc_line_id", "requisition_allocation_lines")
    op.drop_index("ix_req_alloc_req_id", "requisition_allocation_lines")
    op.drop_index("ix_req_lines_req_id", "requisition_lines")
    op.drop_index("ix_prod_req_status", "production_requisitions")
    op.drop_table("requisition_allocation_lines")
    op.drop_table("requisition_lines")
    op.drop_table("production_requisitions")
