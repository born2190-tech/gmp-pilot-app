import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class QCReport(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "qc_reports"

    lot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)
    report_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    method_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    analysis_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    analysis_finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    overall_result: Mapped[str | None] = mapped_column(String(32), nullable=True)
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class QCReportParameter(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "qc_report_parameters"

    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("qc_reports.id"), nullable=False)
    parameter_name: Mapped[str] = mapped_column(String(255), nullable=False)
    specification: Mapped[str] = mapped_column(Text, nullable=False)
    result_value: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    method_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    complies: Mapped[bool] = mapped_column(Boolean, nullable=False)

    report: Mapped[QCReport] = relationship()
