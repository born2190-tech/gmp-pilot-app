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
    supplier_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=False)
    manufacturer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("manufacturers.id"), nullable=False)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    received_date: Mapped[date] = mapped_column(Date, nullable=False)
    posted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    supplier: Mapped[Supplier] = relationship()
    manufacturer: Mapped[Manufacturer] = relationship()
    warehouse: Mapped[Warehouse] = relationship()


class ReceiptLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "receipt_lines"

    receipt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("receipt_documents.id"), nullable=False)
    material_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("materials.id"), nullable=False)
    supplier_lot: Mapped[str] = mapped_column(String(128), nullable=False)
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
    supplier_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=False)
    manufacturer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("manufacturers.id"), nullable=False)
    supplier_lot: Mapped[str] = mapped_column(String(128), nullable=False)
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
    supplier: Mapped[Supplier] = relationship()
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
