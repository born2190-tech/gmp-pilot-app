"""production_requisitions: подтверждение сканом КР-кода (Ф4)

Revision ID: 20260531_0040
Revises: 20260531_0039
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260531_0040"
down_revision = "20260531_0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("production_requisitions", sa.Column("scan_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("production_requisitions", sa.Column("scan_verified_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("production_requisitions", "scan_verified_by")
    op.drop_column("production_requisitions", "scan_verified_at")
