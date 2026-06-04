"""lots: link created lot to receipt line

Revision ID: 20260604_0041
Revises: 20260531_0040
Create Date: 2026-06-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260604_0041"
down_revision = "20260531_0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("lots", sa.Column("receipt_line_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_lots_receipt_line_id_receipt_lines",
        "lots",
        "receipt_lines",
        ["receipt_line_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_lots_receipt_line_id_receipt_lines", "lots", type_="foreignkey")
    op.drop_column("lots", "receipt_line_id")
