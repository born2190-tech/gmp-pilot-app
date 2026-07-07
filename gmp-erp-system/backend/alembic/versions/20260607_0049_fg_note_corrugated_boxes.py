"""fg transfer note: кол-во гофрокоробов (СОП-414 Ф-5)

Revision ID: 20260607_0049
Revises: 20260607_0048
Create Date: 2026-06-07
"""
from alembic import op
import sqlalchemy as sa

revision = "20260607_0049"
down_revision = "20260607_0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("fg_transfer_notes", sa.Column("corrugated_boxes", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("fg_transfer_notes", "corrugated_boxes")
