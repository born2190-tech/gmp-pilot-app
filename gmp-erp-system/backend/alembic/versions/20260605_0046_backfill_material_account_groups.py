"""backfill material account groups and lot accounts

Revision ID: 20260605_0046
Revises: 20260605_0045
Create Date: 2026-06-05
"""
from alembic import op

revision = "20260605_0046"
down_revision = "20260605_0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE materials
        SET account_group = CASE
            WHEN upper(code) LIKE 'API%' OR upper(code) LIKE 'SUB-%'
              OR upper(code) LIKE 'TIG%' OR upper(code) LIKE 'GLZ%'
              OR upper(code) LIKE 'CLP%' OR upper(code) LIKE 'ETR%'
              OR upper(code) LIKE 'ESO%' OR upper(code) LIKE 'TCG%'
              THEN 'SUBSTANCE_API'
            WHEN upper(code) LIKE 'EXC%' OR upper(code) LIKE 'AUX%'
              OR upper(code) LIKE 'COAT%' OR upper(code) LIKE 'UTIL%'
              THEN 'EXCIPIENT'
            WHEN upper(code) LIKE 'PACK%' OR upper(code) LIKE 'PKG%'
              OR upper(code) LIKE 'IM-%' OR upper(code) LIKE 'ИМ%'
              THEN 'PACKAGING'
            ELSE account_group
        END
        WHERE account_group IS NULL
        """
    )
    op.execute(
        """
        UPDATE lots
        SET account_id = ia.id
        FROM materials m, inventory_accounts ia
        WHERE lots.material_id = m.id
          AND ia.account_group = m.account_group
          AND ia.zone = CASE
              WHEN lots.quality_status = 'released' THEN 'RELEASED'
              WHEN lots.quality_status = 'rejected' THEN 'REJECTED'
              ELSE 'QUARANTINE'
          END
          AND ia.is_active = TRUE
          AND m.account_group IS NOT NULL
          AND (lots.account_id IS NULL OR lots.account_id <> ia.id)
        """
    )
    op.execute(
        """
        UPDATE inventory_movements
        SET to_account_id = lots.account_id
        FROM lots
        WHERE inventory_movements.lot_id = lots.id
          AND inventory_movements.movement_type = 'RECEIPT'
          AND inventory_movements.to_account_id IS NULL
          AND lots.account_id IS NOT NULL
        """
    )


def downgrade() -> None:
    pass
