"""fg shipment: поля Didox (ЭСФ) — didox_id, didox_status

Revision ID: 20260608_0052
Revises: 20260608_0051
Create Date: 2026-06-08
"""
from alembic import op
import sqlalchemy as sa

revision = "20260608_0052"
down_revision = "20260608_0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("fg_shipment_documents", sa.Column("didox_id", sa.String(length=128), nullable=True))
    op.add_column("fg_shipment_documents", sa.Column("didox_status", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("fg_shipment_documents", "didox_status")
    op.drop_column("fg_shipment_documents", "didox_id")
