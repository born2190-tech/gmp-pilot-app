"""fg releases: допуск серии ГП карантин→хранение (СОП-205 п.6.3)

Revision ID: 20260607_0050
Revises: 20260607_0049
Create Date: 2026-06-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260607_0050"
down_revision = "20260607_0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fg_releases",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lot_id", UUID(as_uuid=True), sa.ForeignKey("lots.id"), nullable=False, unique=True),
        sa.Column("analytical_passport_no", sa.String(length=128), nullable=False),
        sa.Column("certificate_no", sa.String(length=128), nullable=True),
        sa.Column("released_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("fg_releases")
