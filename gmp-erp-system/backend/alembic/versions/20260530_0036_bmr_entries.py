"""Electronic BMR field entries (tablet fill) — Phase C

bmr_entries: filled values per (instance, section, field) with filler + time;
signature fields store {signed_by, role, signed_at} in value.

Revision ID: 20260530_0036
Revises: 20260530_0035
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "20260530_0036"
down_revision = "20260530_0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bmr_entries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("instance_id", UUID(as_uuid=True), sa.ForeignKey("bmr_instances.id"), nullable=False),
        sa.Column("section_id", UUID(as_uuid=True), sa.ForeignKey("bmr_instance_sections.id"), nullable=False),
        sa.Column("field_index", sa.Integer(), nullable=False),
        sa.Column("value", JSONB(), nullable=True),
        sa.Column("filled_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("filled_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("section_id", "field_index", name="uq_bmr_entry_section_field"),
    )
    op.create_index("ix_bmr_entries_instance_id", "bmr_entries", ["instance_id"])


def downgrade() -> None:
    op.drop_index("ix_bmr_entries_instance_id", table_name="bmr_entries")
    op.drop_table("bmr_entries")
