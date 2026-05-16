"""add physical-address fields to lots (Ф-3 СОП-415)

Revision ID: 20260516_0010
Revises: 20260516_0009
Create Date: 2026-05-16
"""

from alembic import op
import sqlalchemy as sa


revision = "20260516_0010"
down_revision = "20260516_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("lots", sa.Column("rack_no", sa.String(length=32), nullable=True))
    op.add_column("lots", sa.Column("sector_no", sa.String(length=32), nullable=True))
    op.add_column("lots", sa.Column("tier_no", sa.String(length=32), nullable=True))
    op.add_column("lots", sa.Column("place_no", sa.String(length=32), nullable=True))
    op.add_column("lots", sa.Column("pallet_no", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("lots", "pallet_no")
    op.drop_column("lots", "place_no")
    op.drop_column("lots", "tier_no")
    op.drop_column("lots", "sector_no")
    op.drop_column("lots", "rack_no")
