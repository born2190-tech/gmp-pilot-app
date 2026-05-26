"""pricing + inventory accounts + customs declaration (ГТД)

Revision ID: 20260524_0020
Revises: 20260524_0019
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260524_0020"
down_revision = "20260524_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Справочник счетов учёта запасов ──
    op.create_table(
        "inventory_accounts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("account_group", sa.String(length=32), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    # ── Материал: счёт учёта по виду ──
    op.add_column("materials", sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("inventory_accounts.id"), nullable=True))

    # ── Приход: счёт-фактура / договор / валюта / ЭСФ-ID ──
    op.add_column("receipt_documents", sa.Column("invoice_no", sa.String(length=64), nullable=True))
    op.add_column("receipt_documents", sa.Column("invoice_date", sa.Date(), nullable=True))
    op.add_column("receipt_documents", sa.Column("contract_no", sa.String(length=64), nullable=True))
    op.add_column("receipt_documents", sa.Column("contract_date", sa.Date(), nullable=True))
    op.add_column("receipt_documents", sa.Column("currency", sa.String(length=8), nullable=False, server_default="UZS"))
    op.add_column("receipt_documents", sa.Column("einvoice_external_id", sa.String(length=128), nullable=True))

    # ── Строка прихода: ИКПУ / цена / НДС / ТН ВЭД ──
    op.add_column("receipt_lines", sa.Column("ikpu_code", sa.String(length=64), nullable=True))
    op.add_column("receipt_lines", sa.Column("unit_price", sa.Float(), nullable=True))
    op.add_column("receipt_lines", sa.Column("vat_rate", sa.Float(), nullable=True))
    op.add_column("receipt_lines", sa.Column("hs_code", sa.String(length=32), nullable=True))

    # ── Партия: счёт учёта / себестоимость / валюта / ТН ВЭД ──
    op.add_column("lots", sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("inventory_accounts.id"), nullable=True))
    op.add_column("lots", sa.Column("unit_cost", sa.Float(), nullable=True))
    op.add_column("lots", sa.Column("currency", sa.String(length=8), nullable=False, server_default="UZS"))
    op.add_column("lots", sa.Column("hs_code", sa.String(length=32), nullable=True))

    # ── Движение: счета источника/получателя ──
    op.add_column("inventory_movements", sa.Column("from_account_id", UUID(as_uuid=True), sa.ForeignKey("inventory_accounts.id"), nullable=True))
    op.add_column("inventory_movements", sa.Column("to_account_id", UUID(as_uuid=True), sa.ForeignKey("inventory_accounts.id"), nullable=True))

    # ── ГТД + скан ──
    op.create_table(
        "import_declarations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("receipt_id", UUID(as_uuid=True), sa.ForeignKey("receipt_documents.id"), nullable=False),
        sa.Column("gtd_number", sa.String(length=128), nullable=False),
        sa.Column("gtd_date", sa.Date(), nullable=True),
        sa.Column("procedure", sa.String(length=16), nullable=True),
        sa.Column("country_origin", sa.String(length=128), nullable=True),
        sa.Column("country_dispatch", sa.String(length=128), nullable=True),
        sa.Column("foreign_manufacturer", sa.String(length=255), nullable=True),
        sa.Column("broker", sa.String(length=255), nullable=True),
        sa.Column("incoterms", sa.String(length=16), nullable=True),
        sa.Column("contract_currency", sa.String(length=8), nullable=True),
        sa.Column("invoice_value", sa.Float(), nullable=True),
        sa.Column("customs_value", sa.Float(), nullable=True),
        sa.Column("exchange_rate", sa.Float(), nullable=True),
        sa.Column("gross_weight", sa.Float(), nullable=True),
        sa.Column("net_weight", sa.Float(), nullable=True),
        sa.Column("edeclaration_external_id", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_import_declarations_receipt_id", "import_declarations", ["receipt_id"])

    op.create_table(
        "import_declaration_scans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("declaration_id", UUID(as_uuid=True), sa.ForeignKey("import_declarations.id"), nullable=False),
        sa.Column("file_path", sa.String(length=512), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("uploaded_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_import_declaration_scans_declaration_id", "import_declaration_scans", ["declaration_id"])


def downgrade() -> None:
    op.drop_index("ix_import_declaration_scans_declaration_id", table_name="import_declaration_scans")
    op.drop_table("import_declaration_scans")
    op.drop_index("ix_import_declarations_receipt_id", table_name="import_declarations")
    op.drop_table("import_declarations")
    op.drop_column("inventory_movements", "to_account_id")
    op.drop_column("inventory_movements", "from_account_id")
    op.drop_column("lots", "hs_code")
    op.drop_column("lots", "currency")
    op.drop_column("lots", "unit_cost")
    op.drop_column("lots", "account_id")
    op.drop_column("receipt_lines", "hs_code")
    op.drop_column("receipt_lines", "vat_rate")
    op.drop_column("receipt_lines", "unit_price")
    op.drop_column("receipt_lines", "ikpu_code")
    op.drop_column("receipt_documents", "einvoice_external_id")
    op.drop_column("receipt_documents", "currency")
    op.drop_column("receipt_documents", "contract_date")
    op.drop_column("receipt_documents", "contract_no")
    op.drop_column("receipt_documents", "invoice_date")
    op.drop_column("receipt_documents", "invoice_no")
    op.drop_column("materials", "account_id")
    op.drop_table("inventory_accounts")
