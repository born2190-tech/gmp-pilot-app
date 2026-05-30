"""Electronic BMR template constructor (СОП-11) — Phase A

bmr_templates (per product, versioned, draft/approved/obsolete) + bmr_sections
(ordered typed blocks with a JSON config of fields/columns).

Revision ID: 20260530_0034
Revises: 20260530_0033
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "20260530_0034"
down_revision = "20260530_0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bmr_templates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("product_id", UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("approved_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_bmr_templates_product_id", "bmr_templates", ["product_id"])
    op.create_index("ix_bmr_templates_status", "bmr_templates", ["status"])

    op.create_table(
        "bmr_sections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("template_id", UUID(as_uuid=True), sa.ForeignKey("bmr_templates.id"), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("section_type", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("config", JSONB(), nullable=False, server_default="{}"),
    )
    op.create_index("ix_bmr_sections_template_id", "bmr_sections", ["template_id"])


def downgrade() -> None:
    op.drop_index("ix_bmr_sections_template_id", table_name="bmr_sections")
    op.drop_table("bmr_sections")
    op.drop_index("ix_bmr_templates_status", table_name="bmr_templates")
    op.drop_index("ix_bmr_templates_product_id", table_name="bmr_templates")
    op.drop_table("bmr_templates")
