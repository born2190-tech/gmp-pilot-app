"""Products (ЛС) reference + per-product batch numbering

Adds a products reference table and links production_batches to it. Existing
batches are backfilled: one product per distinct product_code, then product_id
is set on every batch. Serial numbering moves from product_code to product_id.

Revision ID: 20260530_0029
Revises: 20260530_0028
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260530_0029"
down_revision = "20260530_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("code", sa.String(length=8), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("dosage_form", sa.String(length=128), nullable=True),
        sa.Column("default_shelf_life_months", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("batch_format", sa.String(length=64), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_products_is_active", "products", ["is_active"])

    op.add_column("production_batches", sa.Column("product_id", UUID(as_uuid=True), nullable=True))

    # Backfill: one product per distinct product_code (latest batch wins for the
    # name/form/shelf-life snapshot), then link every batch to its product.
    op.execute(
        """
        INSERT INTO products (id, created_at, updated_at, code, name, dosage_form,
                              default_shelf_life_months, batch_format, is_active)
        SELECT gen_random_uuid(), now(), now(), t.product_code, t.product_name,
               t.dosage_form, t.shelf_life_months, NULL, true
        FROM (
            SELECT DISTINCT ON (product_code)
                   product_code, product_name, dosage_form, shelf_life_months
            FROM production_batches
            ORDER BY product_code, created_at DESC
        ) t
        ON CONFLICT (code) DO NOTHING;
        """
    )
    op.execute(
        """
        UPDATE production_batches b
        SET product_id = p.id
        FROM products p
        WHERE p.code = b.product_code AND b.product_id IS NULL;
        """
    )

    op.create_foreign_key(
        "fk_production_batches_product_id_products",
        "production_batches",
        "products",
        ["product_id"],
        ["id"],
    )
    op.create_index("ix_production_batches_product_id", "production_batches", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_production_batches_product_id", table_name="production_batches")
    op.drop_constraint("fk_production_batches_product_id_products", "production_batches", type_="foreignkey")
    op.drop_column("production_batches", "product_id")
    op.drop_index("ix_products_is_active", table_name="products")
    op.drop_table("products")
