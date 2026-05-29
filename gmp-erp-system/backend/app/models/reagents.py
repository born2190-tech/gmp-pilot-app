import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Reagent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "qc_reagents"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    grade: Mapped[str | None] = mapped_column(String(255), nullable=True)
    manufacturer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    supplier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    batch_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    internal_batch_number: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    received_date: Mapped[date] = mapped_column(Date, nullable=False)
    opened_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_date_unopened: Mapped[date] = mapped_column(Date, nullable=False)
    expiry_date_after_opening_days: Mapped[int] = mapped_column(nullable=False, default=365)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    quantity: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False, default=0)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    storage_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_conditions: Mapped[str | None] = mapped_column(String(255), nullable=True)
    responsible: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    movements: Mapped[list["ReagentMovement"]] = relationship(
        back_populates="reagent", cascade="all, delete-orphan"
    )
    certificates: Mapped[list["ReagentCertificate"]] = relationship(
        back_populates="reagent", cascade="all, delete-orphan"
    )


class ReagentMovement(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "qc_reagent_movements"

    reagent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("qc_reagents.id", ondelete="CASCADE"), nullable=False
    )
    operation_type: Mapped[str] = mapped_column(String(64), nullable=False)
    quantity_before: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)
    quantity_operation: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)
    quantity_after: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)
    analytical_sheet: Mapped[str | None] = mapped_column(String(128), nullable=True)
    material_batch: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    performed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    reagent: Mapped[Reagent] = relationship(back_populates="movements")


class ReagentCertificate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "qc_reagent_certificates"

    reagent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("qc_reagents.id", ondelete="CASCADE"), nullable=False
    )
    certificate_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size: Mapped[int] = mapped_column(nullable=False)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    reagent: Mapped[Reagent] = relationship(back_populates="certificates")
