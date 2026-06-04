"""bmr_stage_locks: advisory stage lock for concurrent BMR editing

Revision ID: 20260604_0043
Revises: 20260604_0042
Create Date: 2026-06-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260604_0043"
down_revision = "20260604_0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bmr_stage_locks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("instance_id", UUID(as_uuid=True), sa.ForeignKey("bmr_instances.id"), nullable=False),
        sa.Column("stage_code", sa.String(length=64), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("instance_id", "stage_code", name="uq_bmr_stage_lock"),
    )


def downgrade() -> None:
    op.drop_table("bmr_stage_locks")
