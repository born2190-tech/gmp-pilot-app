import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text
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


class QCNotification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "qc_notifications"

    notification_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Lifecycle: created → printed → scan_uploaded → verified → qc_in_progress → completed
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    receipt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("receipt_documents.id"), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    notified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # printed_at/by — set on the first PDF generation. Captured so the audit
    # can prove "the form taken to wet-ink signing was printed by X at T".
    printed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    printed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # state_hash — sha256 over the canonical payload (notification_no + lines)
    # baked into the QR code on first print. Used later to detect tampering
    # between print and scan upload.
    state_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)


class QCNotificationLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "qc_notification_lines"

    notification_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("qc_notifications.id"), nullable=False)
    lot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)
    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    batch_number: Mapped[str] = mapped_column(String(128), nullable=False)
    expiry_date: Mapped[str] = mapped_column(String(32), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    manufacturer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    invoice_info: Mapped[str] = mapped_column(String(255), nullable=False)

    notification: Mapped[QCNotification] = relationship()


class QCNotificationScan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Wet-ink-signed Ф-14 paper, scanned back and stored as true copy.

    One QCNotification can have multiple scans (re-scans on bad quality);
    the latest non-rejected one is the active version. Files live on the
    filesystem under /data/qc-scans/{year}/{month}/{notification_id}/;
    only the path and sha256 are kept in the DB so backups stay cheap and
    the binary content remains tamper-evident.
    """

    __tablename__ = "qc_notification_scans"

    notification_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("qc_notifications.id"), nullable=False)
    version: Mapped[int] = mapped_column(nullable=False, default=1)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False, default="application/pdf")
    file_size: Mapped[int] = mapped_column(nullable=False)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Lifecycle: pending_verification → verified | rejected
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending_verification")
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Verification — set by QA (ДОК), must be different user from uploader.
    verified_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    signature_warehouse_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    signature_qc_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    signature_manager_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    notification: Mapped[QCNotification] = relationship()
