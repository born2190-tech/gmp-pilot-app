"""Electronic BMR instances per batch (СОП-11) — Phase B

bmr_instances (one per production batch, snapshot of the approved template at
ЗПС issue) + bmr_instance_sections (frozen section structure for tablet fill).

Revision ID: 20260530_0035
Revises: 20260530_0034
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "20260530_0035"
down_revision = "20260530_0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bmr_instances",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("production_batch_id", UUID(as_uuid=True), sa.ForeignKey("production_batches.id"), nullable=False),
        sa.Column("template_id", UUID(as_uuid=True), sa.ForeignKey("bmr_templates.id"), nullable=True),
        sa.Column("template_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="issued"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("started_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_bmr_instances_batch_id", "bmr_instances", ["production_batch_id"])

    op.create_table(
        "bmr_instance_sections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("instance_id", UUID(as_uuid=True), sa.ForeignKey("bmr_instances.id"), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("section_type", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("config", JSONB(), nullable=False, server_default="{}"),
    )
    op.create_index("ix_bmr_instance_sections_instance_id", "bmr_instance_sections", ["instance_id"])


def downgrade() -> None:
    op.drop_index("ix_bmr_instance_sections_instance_id", table_name="bmr_instance_sections")
    op.drop_table("bmr_instance_sections")
    op.drop_index("ix_bmr_instances_batch_id", table_name="bmr_instances")
    op.drop_table("bmr_instances")
