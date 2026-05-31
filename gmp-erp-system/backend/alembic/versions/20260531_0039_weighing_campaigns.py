"""weighing_campaigns: межсерийная кампания взвешивания (task #14)

Revision ID: 20260531_0039
Revises: 20260531_0038
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "20260531_0039"
down_revision = "20260531_0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "weighing_campaigns",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("campaign_date", sa.Date(), nullable=False),
        sa.Column("room", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("batches", JSONB(), nullable=False, server_default="[]"),
        sa.Column("ledger", JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_unique_constraint("uq_weighing_campaigns_code", "weighing_campaigns", ["code"])


def downgrade() -> None:
    op.drop_constraint("uq_weighing_campaigns_code", "weighing_campaigns", type_="unique")
    op.drop_table("weighing_campaigns")
