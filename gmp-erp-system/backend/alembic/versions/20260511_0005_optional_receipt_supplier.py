"""optional receipt supplier

Revision ID: 20260511_0005
Revises: 20260510_0004
Create Date: 2026-05-11
"""

from alembic import op


revision = "20260511_0005"
down_revision = "20260510_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("receipt_documents", "supplier_id", nullable=True)
    op.alter_column("receipt_lines", "supplier_lot", nullable=True)
    op.alter_column("lots", "supplier_id", nullable=True)
    op.alter_column("lots", "supplier_lot", nullable=True)


def downgrade() -> None:
    op.alter_column("lots", "supplier_lot", nullable=False)
    op.alter_column("lots", "supplier_id", nullable=False)
    op.alter_column("receipt_lines", "supplier_lot", nullable=False)
    op.alter_column("receipt_documents", "supplier_id", nullable=False)
