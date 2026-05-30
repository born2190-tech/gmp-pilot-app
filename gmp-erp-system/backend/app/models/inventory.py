import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse


class ReceiptDocument(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "receipt_documents"

    document_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=True)
    manufacturer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("manufacturers.id"), nullable=False)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    received_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Счёт-фактура (ЭСФ Didox/Rouming) и договор — вносятся при приёмке.
    invoice_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    contract_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    contract_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="UZS")
    # Идентификатор документа в системе ЭСФ (Didox/Rouming/Soliq) — для сверки
    # и будущего автозаполнения по API.
    einvoice_external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    posted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    supplier: Mapped[Supplier | None] = relationship()
    manufacturer: Mapped[Manufacturer] = relationship()
    warehouse: Mapped[Warehouse] = relationship()


class ReceiptDefect(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Act of an external packaging defect found at receipt time (СОП-209 Ф-12).

    One act per discrete defect: each container/pallet with a problem gets
    its own act. The collection of all acts forms the СОП-209 Ф-12 journal.
    """

    __tablename__ = "receipt_defects"

    act_no: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    receipt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("receipt_documents.id"), nullable=False)
    # Optional — defect may be reported at receipt level (before lines are
    # finalised) or against a specific line/material.
    receipt_line_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("receipt_lines.id"), nullable=True)
    # critical | significant | minor (matches СОП-209 п.6.5 wording)
    severity: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    # Lifecycle: pending → escalated → resolved | returned
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    recorded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_comment: Mapped[str | None] = mapped_column(Text, nullable=True)


class ReceiptDefectPhoto(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "receipt_defect_photos"

    defect_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("receipt_defects.id"), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    file_size: Mapped[int] = mapped_column(nullable=False)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ReceiptCertificate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Сертификат качества производителя (CoA), приложенный при приёмке.

    Для склада субстанций — обязателен: проведение прихода блокируется,
    пока не приложен хотя бы один CoA. Файл хранится на диске (как и прочие
    скан-копии), в БД — путь + sha256 для контроля целостности. Источник
    файла — загрузка или (в будущем) нативный сканер-агент.
    """

    __tablename__ = "receipt_certificates"

    receipt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("receipt_documents.id"), nullable=False)
    # Опционально — к какой строке/материалу относится сертификат.
    receipt_line_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("receipt_lines.id"), nullable=True)
    certificate_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    file_size: Mapped[int] = mapped_column(nullable=False)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ImportDeclaration(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Грузовая таможенная декларация (ГТД, ИМ-40) — одна на приход (импорт).

    Заполняется при приёмке импортных материалов. Скан/электронная выгрузка
    хранятся отдельно (ImportDeclarationScan). Код ТН ВЭД — по строке прихода
    (ReceiptLine.hs_code), т.к. одна ГТД может покрывать несколько материалов.
    """

    __tablename__ = "import_declarations"

    receipt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("receipt_documents.id"), nullable=False)
    # Регистрационный номер ГТД (таможня/дата/№) и дата оформления.
    gtd_number: Mapped[str] = mapped_column(String(128), nullable=False)
    gtd_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    procedure: Mapped[str | None] = mapped_column(String(16), nullable=True)  # напр. «ИМ 40»
    country_origin: Mapped[str | None] = mapped_column(String(128), nullable=True)
    country_dispatch: Mapped[str | None] = mapped_column(String(128), nullable=True)
    foreign_manufacturer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    broker: Mapped[str | None] = mapped_column(String(255), nullable=True)
    incoterms: Mapped[str | None] = mapped_column(String(16), nullable=True)  # CIP, FOB…
    contract_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)  # 840=USD…
    invoice_value: Mapped[float | None] = mapped_column(Float, nullable=True)  # фактурная стоимость
    customs_value: Mapped[float | None] = mapped_column(Float, nullable=True)  # таможенная стоимость
    exchange_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    gross_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    net_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Идентификатор в системе электронного декларирования (для сверки).
    edeclaration_external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class ImportDeclarationScan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Скан/электронная выгрузка ГТД. Хранится на диске, в БД — путь + sha256."""

    __tablename__ = "import_declaration_scans"

    declaration_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("import_declarations.id"), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    file_size: Mapped[int] = mapped_column(nullable=False)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ReceiptLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "receipt_lines"

    receipt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("receipt_documents.id"), nullable=False)
    material_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("materials.id"), nullable=False)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=True)
    manufacturer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("manufacturers.id"), nullable=False)
    supplier_lot: Mapped[str | None] = mapped_column(String(128), nullable=True)
    production_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    production_year: Mapped[int] = mapped_column(nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    location_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    # Цена/НДС из строки счёта-фактуры + код ИКПУ; код ТН ВЭД (для импорта).
    ikpu_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    unit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    vat_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    hs_code: Mapped[str | None] = mapped_column(String(32), nullable=True)

    receipt: Mapped[ReceiptDocument] = relationship()
    material: Mapped[Material] = relationship()
    supplier: Mapped[Supplier | None] = relationship()
    manufacturer: Mapped[Manufacturer] = relationship()
    location: Mapped[Location] = relationship()


class Lot(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "lots"

    material_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("materials.id"), nullable=False)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=True)
    manufacturer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("manufacturers.id"), nullable=False)
    supplier_lot: Mapped[str | None] = mapped_column(String(128), nullable=True)
    internal_lot: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    item_type: Mapped[str] = mapped_column(String(64), nullable=False)
    production_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    production_year: Mapped[int] = mapped_column(nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    location_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    # Счёт учёта (текущий): при приёмке наследуется от материала, может
    # меняться перемещением (АФИ → цех) — перенос стоимости со счёта на счёт.
    account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("inventory_accounts.id"), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    # Initial quantity captured at receipt; never decreases. Used as the
    # denominator for the «мало остатков» KPI (current/initial < 10%).
    initial_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    # Себестоимость единицы из счёта-фактуры (валюта прихода). Стоимость
    # партии = quantity × unit_cost — основа стоимостной оборотной ведомости.
    unit_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="UZS")
    hs_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    quality_status: Mapped[str] = mapped_column(String(32), nullable=False)
    # Physical address inside the warehouse (form Ф-3 СОП-415: учётная карточка
    # сырья). All optional — operator fills what's relevant for the warehouse
    # type. Updated by transfer operations.
    rack_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sector_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    tier_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    place_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pallet_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    incoming_control_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sampling_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    qc_result_received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    qa_decision_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    material: Mapped[Material] = relationship()
    supplier: Mapped[Supplier | None] = relationship()
    manufacturer: Mapped[Manufacturer] = relationship()
    warehouse: Mapped[Warehouse] = relationship()
    location: Mapped[Location] = relationship()


class InventoryMovement(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "inventory_movements"

    movement_type: Mapped[str] = mapped_column(String(64), nullable=False)
    document_type: Mapped[str] = mapped_column(String(64), nullable=False)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    lot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)
    from_warehouse_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=True)
    from_location_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True)
    to_warehouse_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=True)
    to_location_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True)
    # Счета учёта источника/получателя — для переноса стоимости (АФИ → цех).
    from_account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("inventory_accounts.id"), nullable=True)
    to_account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("inventory_accounts.id"), nullable=True)
    quantity_delta: Mapped[float] = mapped_column(Float, nullable=False)
    quantity_after: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    workstation_id: Mapped[str] = mapped_column(String(128), nullable=False)

    lot: Mapped[Lot] = relationship()


class FGShipmentDocument(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "fg_shipment_documents"

    document_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_tax_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    destination_address: Mapped[str] = mapped_column(String(500), nullable=False)
    shipment_date: Mapped[date] = mapped_column(Date, nullable=False)
    vehicle_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    waybill_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    posted_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class FGShipmentLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "fg_shipment_lines"

    shipment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("fg_shipment_documents.id"), nullable=False)
    lot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    quantity_after: Mapped[float] = mapped_column(Float, nullable=False)

    shipment: Mapped[FGShipmentDocument] = relationship()
    lot: Mapped[Lot] = relationship()


class InventoryCountDocument(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "inventory_count_documents"

    document_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    count_date: Mapped[date] = mapped_column(Date, nullable=False)
    posted_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    warehouse: Mapped[Warehouse] = relationship()


class InventoryCountLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "inventory_count_lines"

    count_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("inventory_count_documents.id"), nullable=False)
    lot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)
    system_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    actual_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    variance: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)

    count: Mapped[InventoryCountDocument] = relationship()
    lot: Mapped[Lot] = relationship()


# ---------------------------------------------------------------------------
# Inventory count wave (GMP-style 4-eyes inventory)
# ---------------------------------------------------------------------------
#
# Replaces the simple one-shot InventoryCountDocument with a multi-stage
# workflow: planning → counting → verification → posted (+ cancelled).
#
# - planning: QA defines scope; system snapshots system_qty for each lot
# - counting: counters record actual qty per lot; can save partial progress
# - verification: lines whose variance exceeds tolerance go to a separate
#   verifier (4-eyes: verifier ≠ counter) for physical re-count
# - posted: QA signs the wave; system writes ADJUSTMENT movements and
#   updates lot quantities to actual; wave becomes immutable.
# ---------------------------------------------------------------------------


class InventoryCountWave(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "inventory_count_waves"

    wave_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # planning | counting | verification | posted | cancelled
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    # Free-text human description of scope ("Весь склад", "Стеллаж A-3"…) —
    # we keep the per-lot membership in WaveLine rows; this field is just
    # for display so the inspector can read the audit history.
    scope_description: Mapped[str] = mapped_column(String(255), nullable=False)
    # Lots whose absolute variance is ≤ tolerance_pct% of system_qty are
    # treated as within tolerance and don't need verifier sign-off.
    tolerance_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    counters: Mapped[str | None] = mapped_column(String(500), nullable=True)
    verifier_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    posted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    warehouse: Mapped[Warehouse] = relationship()
    lines: Mapped[list["InventoryCountWaveLine"]] = relationship(
        back_populates="wave",
        cascade="all, delete-orphan",
    )


class InventoryCountWaveLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "inventory_count_wave_lines"

    wave_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("inventory_count_waves.id"), nullable=False)
    lot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)
    # pending | counted | within_tolerance | needs_verification | verified | rejected
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    system_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    actual_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    variance: Mapped[float | None] = mapped_column(Float, nullable=True)
    variance_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    counted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    counted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verifier_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    wave: Mapped[InventoryCountWave] = relationship(back_populates="lines")
    lot: Mapped[Lot] = relationship()


# ---------------------------------------------------------------------------
# Production Requisition (Требование/Накладная на внутреннее перемещение)
# ---------------------------------------------------------------------------

class ProductionRequisition(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Header of a material requisition submitted by production to warehouse(s)."""
    __tablename__ = "production_requisitions"

    requisition_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Overall status: draft → submitted → processing → partially_issued → issued | cancelled
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_series: Mapped[str | None] = mapped_column(String(128), nullable=True)
    production_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    production_order_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lines: Mapped[list["RequisitionLine"]] = relationship(back_populates="requisition", cascade="all, delete-orphan")


class RequisitionLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One material line in a production requisition (what production needs)."""
    __tablename__ = "requisition_lines"

    requisition_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("production_requisitions.id"), nullable=False)
    material_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("materials.id"), nullable=False)
    requested_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    # warehouse_type is set automatically from material lots (SUBSTANCE_WAREHOUSE / PACKAGING_WAREHOUSE)
    warehouse_type: Mapped[str] = mapped_column(String(64), nullable=False)
    # Filled in after warehouse issues
    issued_quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # line status: pending | partially_issued | issued
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")

    requisition: Mapped[ProductionRequisition] = relationship(back_populates="lines")
    material: Mapped[Material] = relationship()
    allocation_lines: Mapped[list["RequisitionAllocationLine"]] = relationship(
        back_populates="requisition_line", cascade="all, delete-orphan"
    )


class RequisitionAllocationLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One lot slice allocated by warehouse for a requisition line (FEFO result or manual edit)."""
    __tablename__ = "requisition_allocation_lines"

    requisition_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("production_requisitions.id"), nullable=False)
    requisition_line_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("requisition_lines.id"), nullable=False)
    lot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)
    warehouse_type: Mapped[str] = mapped_column(String(64), nullable=False)
    allocated_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    # status: draft (pending issue) | issued
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    issued_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    requisition_line: Mapped[RequisitionLine] = relationship(back_populates="allocation_lines")
    lot: Mapped[Lot] = relationship()


# ---------------------------------------------------------------------------
# Production batch start gate (СОП-409 + BMR readiness)
# ---------------------------------------------------------------------------

class ProductionBatch(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Controlled start of a manufacturing batch/series before material issue."""

    __tablename__ = "production_batches"

    batch_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="assigned")
    product_code: Mapped[str] = mapped_column(String(8), nullable=False)
    serial_no: Mapped[int] = mapped_column(Integer, nullable=False)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    dosage_form: Mapped[str | None] = mapped_column(String(128), nullable=True)
    batch_size: Mapped[float] = mapped_column(Float, nullable=False)
    batch_size_unit: Mapped[str] = mapped_column(String(32), nullable=False)
    production_date: Mapped[date] = mapped_column(Date, nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    shelf_life_months: Mapped[int] = mapped_column(Integer, nullable=False)
    bmr_no: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    number_checked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    number_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bmr_issued_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    bmr_issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    room_ready: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    equipment_ready: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    scales_checked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    materials_ready: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    qa_line_clearance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    checklist_updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    checklist_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
