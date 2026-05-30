"""Product market variants

Revision ID: 20260530_0033
Revises: 20260530_0032
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa


revision = "20260530_0033"
down_revision = "20260530_0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("market_code", sa.String(length=16), nullable=True))
    op.add_column("products", sa.Column("market_name", sa.String(length=64), nullable=True))
    op.execute("UPDATE products SET market_code = 'UZ', market_name = 'Узбекистан' WHERE market_code IS NULL")
    op.alter_column("products", "market_code", nullable=False)
    op.alter_column("products", "market_name", nullable=False)

    op.drop_constraint("products_code_key", "products", type_="unique")
    op.create_unique_constraint("uq_products_code_market", "products", ["code", "market_code"])
    op.create_index("ix_products_code_market", "products", ["code", "market_code"])

    # Correct trade names for Uzbekistan market.
    op.execute(
        """
        UPDATE products SET name = '«Новусита» таблетки, покрытые оболочкой'
        WHERE code IN ('026', '027') AND market_code = 'UZ';
        UPDATE products SET name = '«Новусита-М» таблетки, покрытые оболочкой'
        WHERE code IN ('035', '036', '037') AND market_code = 'UZ';
        """
    )

    # Market variants for Afghanistan and Tajikistan keep the Sitafo/Sitafo-M trade name.
    op.execute(
        """
        INSERT INTO products (id, created_at, updated_at, code, market_code, market_name, name,
                              dosage_form, default_shelf_life_months, batch_format, is_active, notes)
        SELECT gen_random_uuid(), now(), now(), src.code, src.market_code, src.market_name, src.name,
               p.dosage_form, p.default_shelf_life_months, p.batch_format, p.is_active, p.notes
        FROM (
            VALUES
              ('026', 'AF', 'Афганистан', '«Ситафор» таблетки, покрытые оболочкой'),
              ('027', 'AF', 'Афганистан', '«Ситафор» таблетки, покрытые оболочкой'),
              ('035', 'AF', 'Афганистан', '«Ситафор-М» таблетки, покрытые оболочкой'),
              ('036', 'AF', 'Афганистан', '«Ситафор-М» таблетки, покрытые оболочкой'),
              ('037', 'AF', 'Афганистан', '«Ситафор-М» таблетки, покрытые оболочкой'),
              ('026', 'TJ', 'Таджикистан', '«Ситафор» таблетки, покрытые оболочкой'),
              ('027', 'TJ', 'Таджикистан', '«Ситафор» таблетки, покрытые оболочкой'),
              ('035', 'TJ', 'Таджикистан', '«Ситафор-М» таблетки, покрытые оболочкой'),
              ('036', 'TJ', 'Таджикистан', '«Ситафор-М» таблетки, покрытые оболочкой'),
              ('037', 'TJ', 'Таджикистан', '«Ситафор-М» таблетки, покрытые оболочкой')
        ) AS src(code, market_code, market_name, name)
        JOIN products p ON p.code = src.code AND p.market_code = 'UZ'
        ON CONFLICT (code, market_code) DO UPDATE
        SET market_name = EXCLUDED.market_name,
            name = EXCLUDED.name,
            dosage_form = EXCLUDED.dosage_form,
            default_shelf_life_months = EXCLUDED.default_shelf_life_months,
            notes = EXCLUDED.notes,
            updated_at = now();
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM products WHERE market_code IN ('AF', 'TJ')")
    op.drop_index("ix_products_code_market", table_name="products")
    op.drop_constraint("uq_products_code_market", "products", type_="unique")
    op.create_unique_constraint("products_code_key", "products", ["code"])
    op.drop_column("products", "market_name")
    op.drop_column("products", "market_code")
