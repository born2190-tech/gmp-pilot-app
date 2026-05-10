from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    password: Mapped[str] = mapped_column(String, nullable=False)
    warehouse_scope: Mapped[str | None] = mapped_column(String, nullable=True)


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    material_code: Mapped[str] = mapped_column(String, nullable=False)
    material_name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class Lot(Base):
    __tablename__ = "lots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"), nullable=False)
    supplier_lot: Mapped[str] = mapped_column(String, nullable=False)
    internal_lot: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    warehouse_type: Mapped[str] = mapped_column(String, nullable=False)
    production_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expiry_date: Mapped[str | None] = mapped_column(String, nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    location: Mapped[str] = mapped_column(String, nullable=False)
    quality_status: Mapped[str] = mapped_column(String, nullable=False)
    incoming_control_notified_at: Mapped[str | None] = mapped_column(String, nullable=True)
    qc_result_received_at: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class SamplingTask(Base):
    __tablename__ = "sampling_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lot_id: Mapped[int] = mapped_column(ForeignKey("lots.id"), nullable=False)
    test_name: Mapped[str] = mapped_column(String, nullable=False)
    specification_ref: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    created_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class QCReport(Base):
    __tablename__ = "qc_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("sampling_tasks.id"), nullable=False)
    lot_id: Mapped[int] = mapped_column(ForeignKey("lots.id"), nullable=False)
    parameters_count: Mapped[int] = mapped_column(Integer, nullable=False)
    overall_out_of_spec: Mapped[int] = mapped_column(Integer, nullable=False)
    entered_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class QCResult(Base):
    __tablename__ = "qc_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[int | None] = mapped_column(ForeignKey("qc_reports.id"), nullable=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("sampling_tasks.id"), nullable=False)
    lot_id: Mapped[int] = mapped_column(ForeignKey("lots.id"), nullable=False)
    parameter_name: Mapped[str | None] = mapped_column(String, nullable=True)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    lower_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    upper_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    out_of_spec: Mapped[int] = mapped_column(Integer, nullable=False)
    instrument: Mapped[str] = mapped_column(String, nullable=False)
    entered_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class QADecision(Base):
    __tablename__ = "qa_decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lot_id: Mapped[int] = mapped_column(ForeignKey("lots.id"), nullable=False)
    decision: Mapped[str] = mapped_column(String, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class ProductionOrder(Base):
    __tablename__ = "production_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_code: Mapped[str] = mapped_column(String, nullable=False)
    product_name: Mapped[str] = mapped_column(String, nullable=False)
    planned_batch_size: Mapped[float] = mapped_column(Float, nullable=False)
    required_lot_ids: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    created_by: Mapped[str] = mapped_column(String, nullable=False)
    started_by: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)


class EBRTemplate(Base):
    __tablename__ = "ebr_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    product_code: Mapped[str] = mapped_column(String, nullable=False)
    steps_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class EBRExecution(Base):
    __tablename__ = "ebr_executions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("ebr_templates.id"), nullable=False)
    production_order_id: Mapped[int] = mapped_column(ForeignKey("production_orders.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    created_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    closed_at: Mapped[str | None] = mapped_column(String, nullable=True)


class EBRStep(Base):
    __tablename__ = "ebr_steps"
    __table_args__ = (UniqueConstraint("execution_id", "step_no", name="uq_ebr_steps_execution_step"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    execution_id: Mapped[int] = mapped_column(ForeignKey("ebr_executions.id"), nullable=False)
    step_no: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    mandatory: Mapped[bool] = mapped_column(Boolean, nullable=False)
    requires_signature: Mapped[bool] = mapped_column(Boolean, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str | None] = mapped_column(String, nullable=True)
    instrument: Mapped[str | None] = mapped_column(String, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_by: Mapped[str | None] = mapped_column(String, nullable=True)
    completed_at: Mapped[str | None] = mapped_column(String, nullable=True)


class Deviation(Base):
    __tablename__ = "deviations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lot_id: Mapped[int] = mapped_column(ForeignKey("lots.id"), nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    created_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class SignatureEvent(Base):
    __tablename__ = "signature_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    action_type: Mapped[str] = mapped_column(String, nullable=False)
    object_type: Mapped[str] = mapped_column(String, nullable=False)
    object_id: Mapped[str] = mapped_column(String, nullable=False)
    meaning: Mapped[str] = mapped_column(Text, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp_utc: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    role_at_time: Mapped[str] = mapped_column(String, nullable=False)
    object_type: Mapped[str] = mapped_column(String, nullable=False)
    object_id: Mapped[str] = mapped_column(String, nullable=False)
    action_type: Mapped[str] = mapped_column(String, nullable=False)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String, nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String, nullable=True)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    token: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    workstation_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[str] = mapped_column(String, nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp_utc: Mapped[str] = mapped_column(String, nullable=False)
    movement_type: Mapped[str] = mapped_column(String, nullable=False)
    lot_id: Mapped[int] = mapped_column(ForeignKey("lots.id"), nullable=False)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"), nullable=False)
    warehouse_type: Mapped[str] = mapped_column(String, nullable=False)
    quantity_delta: Mapped[float] = mapped_column(Float, nullable=False)
    quantity_after: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    reference_type: Mapped[str | None] = mapped_column(String, nullable=True)
    reference_id: Mapped[str | None] = mapped_column(String, nullable=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
