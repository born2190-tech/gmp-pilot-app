"""add Ф-1 sampling norms to materials

Revision ID: 20260518_0015
Revises: 20260518_0014
Create Date: 2026-05-18
"""

from alembic import op
import sqlalchemy as sa


revision = "20260518_0015"
down_revision = "20260518_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("materials", sa.Column("sample_pc_qty", sa.Float(), nullable=True))
    op.add_column("materials", sa.Column("sample_micro_qty", sa.Float(), nullable=True))
    op.add_column("materials", sa.Column("sample_archive_qty", sa.Float(), nullable=True))
    op.add_column("materials", sa.Column("sample_stability_qty", sa.Float(), nullable=True))
    op.add_column("materials", sa.Column("sample_unit", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("materials", "sample_unit")
    op.drop_column("materials", "sample_stability_qty")
    op.drop_column("materials", "sample_archive_qty")
    op.drop_column("materials", "sample_micro_qty")
    op.drop_column("materials", "sample_pc_qty")
