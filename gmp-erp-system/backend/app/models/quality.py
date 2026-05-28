import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
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

    # Условия проведения анализа (шапка аналитического листа Ф-11).
    equipment: Mapped[str | None] = mapped_column(Text, nullable=True)
    room_temp: Mapped[str | None] = mapped_column(String(32), nullable=True)
    humidity: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Микробиологический раздел (СОП-514). Для ГП по НД может не требоваться.
    micro_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    micro_method_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    micro_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    micro_finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Many-to-many с реестром КИП (общие приборы анализа). Per-параметр
    # уточнение хранится в QCReportParameter.equipment_id.
    equipments: Mapped[list["Equipment"]] = relationship(
        "Equipment",
        secondary="qc_report_equipment",
        lazy="selectin",
    )


class QCReportParameter(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "qc_report_parameters"

    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("qc_reports.id"), nullable=False)
    # 'physicochemical' (ФХ) | 'microbiological' (микро, СОП-514)
    category: Mapped[str] = mapped_column(String(20), nullable=False, default="physicochemical")
    parameter_name: Mapped[str] = mapped_column(String(255), nullable=False)
    specification: Mapped[str] = mapped_column(Text, nullable=False)
    result_value: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    method_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    complies: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # Прибор, использованный именно для этого показателя (optional).
    equipment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("equipment.id"), nullable=True
    )

    report: Mapped[QCReport] = relationship()
    equipment: Mapped["Equipment | None"] = relationship("Equipment", lazy="selectin")


class QCReportScan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Скан подписанного аналитического листа (Ф-11) к протоколу ОКК.

    Хранится на диске, в БД — путь + sha256. Именно этот скан выдаётся при
    скачивании аналитического листа в реестре/дашборде (а не авто-PDF)."""

    __tablename__ = "qc_report_scans"

    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("qc_reports.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False, default="application/pdf")
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class OOSInvestigation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Расследование несоответствия результата (OOS / РНС, СОП-549).

    Создаётся автоматически при подписании протокола ОКК с вердиктом
    «НЕ соответствует». Пока расследование открыто — допуск серии (ОКА)
    заблокирован. Заключение определяет диспозицию: подтверждённый брак,
    лабораторная ошибка (ретест) или использование с обоснованием.
    """

    __tablename__ = "oos_investigations"

    number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("qc_reports.id"), nullable=False)
    lot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)
    # open | investigating | closed
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="open")
    # Сводка проваленных показателей (текст).
    failed_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    conclusion: Mapped[str | None] = mapped_column(Text, nullable=True)
    # confirmed_reject | lab_error_retest | use_as_is
    disposition: Mapped[str | None] = mapped_column(String(32), nullable=True)
    opened_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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


class SamplingAct(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Акт отбора средней пробы — СОП-533 Ф-10 (сырьё/упаковка) или
    СОП-548 Ф-10 (готовая продукция).

    Один акт на партию (строго). Жизненный цикл:
    draft → scan_uploaded → verified | cancelled.

    При переходе в `verified` (после загрузки скана и подписи ОКК) система
    атомарно списывает сумму проб с lot.quantity, ставит lot.sampling_date
    и создаёт InventoryMovement(type=SAMPLING). До статуса `verified`
    лабораторный анализ по партии заблокирован.
    """

    __tablename__ = "sampling_acts"

    act_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    lot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)
    qc_notification_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("qc_notifications.id"), nullable=True
    )
    # Какой шаблон формы: '533' (сырьё/упаковка) или '548' (ГП). Определяется
    # автоматически по типу склада/материала при создании.
    sop_form: Mapped[str] = mapped_column(String(8), nullable=False, default="533")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")

    # Комиссия (3 ФИО из справочника пользователей; в PDF идут как текст).
    head_qc_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    warehouse_member_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    qc_representative_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    # Условия отбора.
    sampling_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    sampling_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sample_condition: Mapped[str | None] = mapped_column(String(255), nullable=True)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    humidity_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    scale_model: Mapped[str | None] = mapped_column(String(255), nullable=True)  # только 533
    scale_calibration_no: Mapped[str | None] = mapped_column(String(128), nullable=True)  # только 533
    transport_with_ice: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    specification_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)  # EP/USP/ФСП
    registration_no: Mapped[str | None] = mapped_column(String(128), nullable=True)  # R-DV/M, только 548

    # Многоступенчатый отбор (только 548; формула 0.4·√n).
    containers_outer_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    containers_outer_sampled: Mapped[int | None] = mapped_column(Integer, nullable=True)
    containers_inner_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    containers_inner_sampled: Mapped[int | None] = mapped_column(Integer, nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    posted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lines: Mapped[list["SamplingLine"]] = relationship(
        back_populates="sampling_act", cascade="all, delete-orphan"
    )


class SamplingLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Строка отбираемого количества по назначению пробы."""

    __tablename__ = "sampling_lines"

    sampling_act_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sampling_acts.id"), nullable=False
    )
    # PHYSICOCHEMICAL | MICROBIOLOGICAL | ARCHIVE | STABILITY (последний только для 548)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)

    sampling_act: Mapped[SamplingAct] = relationship(back_populates="lines")


class MaterialSpecification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Спецификация (НД) на материал — справочник норм входного контроля.

    Содержит шапку НД и перечень показателей качества (SpecificationParameter).
    Используется аналитическим листом ОКК: «Загрузить шаблон» подставляет
    параметры и нормы именно этой спецификации. Привязка к материалу — по
    `material_id` (если задан) либо по ключевым словам `match_keywords`.
    """

    __tablename__ = "material_specifications"

    nd_code: Mapped[str] = mapped_column(String(128), nullable=False)
    revision: Mapped[str | None] = mapped_column(String(32), nullable=True)
    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    material_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("materials.id"), nullable=True)
    # Ключевые слова для сопоставления с партией (нижний регистр, через пробел/запятую).
    match_keywords: Mapped[str | None] = mapped_column(String(512), nullable=True)
    sop_form: Mapped[str] = mapped_column(String(8), nullable=False, default="533")
    micro_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    micro_method_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    parameters: Mapped[list["SpecificationParameter"]] = relationship(
        back_populates="specification_row", cascade="all, delete-orphan"
    )


class SpecificationParameter(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Строка показателя качества спецификации (норма + метод)."""

    __tablename__ = "specification_parameters"

    specification_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("material_specifications.id"), nullable=False
    )
    # 'physicochemical' (ФХ) | 'microbiological' (микро)
    category: Mapped[str] = mapped_column(String(20), nullable=False, default="physicochemical")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    parameter_name: Mapped[str] = mapped_column(String(255), nullable=False)
    specification: Mapped[str] = mapped_column(Text, nullable=False)
    method_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)

    specification_row: Mapped[MaterialSpecification] = relationship(back_populates="parameters")


class SamplingScan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Скан подписанного бумажного акта Ф-10. Хранится на диске, в БД —
    путь + sha256 (как QCNotificationScan)."""

    __tablename__ = "sampling_scans"

    sampling_act_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sampling_acts.id"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False, default="application/pdf")
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    sampling_act: Mapped[SamplingAct] = relationship()
