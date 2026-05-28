"""Реестр контрольно-измерительных приборов (КИП) + история калибровок.

Используется ОКК при вводе результата анализа: аналитик выбирает прибор(ы)
из реестра, система предупреждает о просроченной/отсутствующей калибровке
(GMP Annex 15 — квалификация и калибровка оборудования)."""
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, String, Table, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


# Шапка аналитического листа: «приборы, использованные при анализе».
qc_report_equipment = Table(
    "qc_report_equipment",
    Base.metadata,
    Column(
        "report_id",
        UUID(as_uuid=True),
        ForeignKey("qc_reports.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "equipment_id",
        UUID(as_uuid=True),
        ForeignKey("equipment.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
)


class Equipment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "equipment"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Категория: ВЭЖХ, ИК-спектрометр, весы, рН-метр, термостат, прибор
    # «Растворение», тестер прочности и т.д.
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    manufacturer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    serial_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    calibrations: Mapped[list["EquipmentCalibration"]] = relationship(
        back_populates="equipment", cascade="all, delete-orphan"
    )


class EquipmentCalibration(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Запись о калибровке/поверке прибора (период действия + сертификат)."""

    __tablename__ = "equipment_calibrations"

    equipment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("equipment.id", ondelete="CASCADE"), nullable=False
    )
    certificate_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    performed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_until: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    equipment: Mapped[Equipment] = relationship(back_populates="calibrations")
