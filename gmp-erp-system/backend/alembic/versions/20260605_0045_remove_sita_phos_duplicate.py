"""remove duplicate SITA-PHOS material

Revision ID: 20260605_0045
Revises: 20260605_0044
Create Date: 2026-06-05
"""
from alembic import op

revision = "20260605_0045"
down_revision = "20260605_0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE material_specifications
        SET material_id = (SELECT id FROM materials WHERE code = 'API-SITA')
        WHERE material_id = (SELECT id FROM materials WHERE code = 'SITA-PHOS')
          AND EXISTS (SELECT 1 FROM materials WHERE code = 'API-SITA')
        """
    )
    op.execute(
        """
        DELETE FROM material_aliases
        WHERE material_id = (SELECT id FROM materials WHERE code = 'SITA-PHOS')
        """
    )
    op.execute(
        """
        DELETE FROM materials
        WHERE code = 'SITA-PHOS'
          AND NOT EXISTS (SELECT 1 FROM lots WHERE lots.material_id = materials.id)
          AND NOT EXISTS (SELECT 1 FROM receipt_lines WHERE receipt_lines.material_id = materials.id)
          AND NOT EXISTS (SELECT 1 FROM requisition_lines WHERE requisition_lines.material_id = materials.id)
        """
    )


def downgrade() -> None:
    pass
