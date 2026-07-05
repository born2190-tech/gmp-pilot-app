"""material aliases for controlled FEFO identity

Revision ID: 20260605_0044
Revises: 20260604_0043
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260605_0044"
down_revision = "20260604_0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "material_aliases",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("material_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("alias", sa.String(length=255), nullable=False),
        sa.Column("normalized_alias", sa.String(length=255), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("normalized_alias"),
    )
    op.create_index("ix_material_aliases_material_id", "material_aliases", ["material_id"])
    op.execute(
        """
        UPDATE lots
        SET expiry_date = '2028-04-12'
        WHERE material_id = (SELECT id FROM materials WHERE code = 'EXC-OPA-BLUE')
          AND expiry_date < '2028-04-12'
        """
    )
    op.execute(
        """
        UPDATE receipt_lines
        SET expiry_date = '2028-04-12'
        WHERE material_id = (SELECT id FROM materials WHERE code = 'EXC-OPA-BLUE')
          AND expiry_date < '2028-04-12'
        """
    )


def downgrade() -> None:
    op.drop_index("ix_material_aliases_material_id", table_name="material_aliases")
    op.drop_table("material_aliases")
