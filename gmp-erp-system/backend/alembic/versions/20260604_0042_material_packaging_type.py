"""materials: packaging_type for SOP-543 secondary packaging QC methods

Revision ID: 20260604_0042
Revises: 20260604_0041
Create Date: 2026-06-04
"""
from alembic import op
import sqlalchemy as sa

revision = "20260604_0042"
down_revision = "20260604_0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("materials", sa.Column("packaging_type", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("materials", "packaging_type")
