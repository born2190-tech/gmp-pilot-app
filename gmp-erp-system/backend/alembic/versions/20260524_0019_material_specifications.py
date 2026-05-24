"""material specifications registry (НД) + parameters

Revision ID: 20260524_0019
Revises: 20260524_0018
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260524_0019"
down_revision = "20260524_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "material_specifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("nd_code", sa.String(length=128), nullable=False),
        sa.Column("revision", sa.String(length=32), nullable=True),
        sa.Column("material_name", sa.String(length=255), nullable=False),
        sa.Column("material_id", UUID(as_uuid=True), sa.ForeignKey("materials.id"), nullable=True),
        sa.Column("match_keywords", sa.String(length=512), nullable=True),
        sa.Column("sop_form", sa.String(length=8), nullable=False, server_default="533"),
        sa.Column("micro_required", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("micro_method_ref", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_material_specifications_material_id", "material_specifications", ["material_id"])

    op.create_table(
        "specification_parameters",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("specification_id", UUID(as_uuid=True), sa.ForeignKey("material_specifications.id"), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False, server_default="physicochemical"),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("parameter_name", sa.String(length=255), nullable=False),
        sa.Column("specification", sa.Text(), nullable=False),
        sa.Column("method_reference", sa.String(length=255), nullable=True),
        sa.Column("unit", sa.String(length=32), nullable=True),
    )
    op.create_index("ix_specification_parameters_specification_id", "specification_parameters", ["specification_id"])


def downgrade() -> None:
    op.drop_index("ix_specification_parameters_specification_id", table_name="specification_parameters")
    op.drop_table("specification_parameters")
    op.drop_index("ix_material_specifications_material_id", table_name="material_specifications")
    op.drop_table("material_specifications")
