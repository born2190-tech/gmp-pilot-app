import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, String
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
    posted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    supplier: Mapped[Supplier | None] = relationship()
    manufacturer: Mapped[Manufacturer] = relationship()
    warehouse: Mapped[Warehouse] = relationship()


class ReceiptLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "receipt_lines"

    receipt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("receipt_documents.id"), nullable=False)
    material_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("materials.id"), nullable=False)
    supplier_lot: Mapped[str | None] = mapped_column(String(128), nullable=True)
    production_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    production_year: Mapped[int] = mapped_column(nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    location_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)

    receipt: Mapped[ReceiptDocument] = relationship()
    material: Mapped[Material] = relationship()
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
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    quality_status: Mapped[str] = mapped_column(String(32), nullable=False)
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
