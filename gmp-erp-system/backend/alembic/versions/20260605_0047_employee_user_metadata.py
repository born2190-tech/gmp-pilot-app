"""users: employee metadata for BMR assignments

Revision ID: 20260605_0047
Revises: 20260605_0046
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa

revision = "20260605_0047"
down_revision = "20260605_0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("employee_no", sa.String(length=16), nullable=True))
    op.add_column("users", sa.Column("position_title", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("signature_initials", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "signature_initials")
    op.drop_column("users", "position_title")
    op.drop_column("users", "employee_no")
