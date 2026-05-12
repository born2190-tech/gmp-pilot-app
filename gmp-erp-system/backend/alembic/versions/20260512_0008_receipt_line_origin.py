"""receipt line origin

Revision ID: 20260512_0008
Revises: 20260512_0007
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260512_0008"
down_revision = "20260512_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("receipt_lines", sa.Column("supplier_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("receipt_lines", sa.Column("manufacturer_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_receipt_lines_supplier_id_suppliers", "receipt_lines", "suppliers", ["supplier_id"], ["id"])
    op.create_foreign_key("fk_receipt_lines_manufacturer_id_manufacturers", "receipt_lines", "manufacturers", ["manufacturer_id"], ["id"])
    op.execute(
        """
        UPDATE receipt_lines
        SET supplier_id = receipt_documents.supplier_id,
            manufacturer_id = receipt_documents.manufacturer_id
        FROM receipt_documents
        WHERE receipt_lines.receipt_id = receipt_documents.id
        """
    )
    op.alter_column("receipt_lines", "manufacturer_id", nullable=False)


def downgrade() -> None:
    op.drop_constraint("fk_receipt_lines_manufacturer_id_manufacturers", "receipt_lines", type_="foreignkey")
    op.drop_constraint("fk_receipt_lines_supplier_id_suppliers", "receipt_lines", type_="foreignkey")
    op.drop_column("receipt_lines", "manufacturer_id")
    op.drop_column("receipt_lines", "supplier_id")
