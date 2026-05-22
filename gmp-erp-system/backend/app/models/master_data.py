import uuid

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Warehouse(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "warehouses"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    warehouse_type: Mapped[str] = mapped_column(String(64), nullable=False)


class Location(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "locations"

    warehouse_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_condition: Mapped[str | None] = mapped_column(String(255), nullable=True)

    warehouse: Mapped[Warehouse] = relationship()


class Supplier(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "suppliers"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class Manufacturer(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "manufacturers"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class Material(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "materials"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    item_type: Mapped[str] = mapped_column(String(64), nullable=False)
    default_unit: Mapped[str] = mapped_column(String(32), nullable=False)
    # Нормы отбора средней пробы (оцифровка Ф-1 к СОП-533/548). Заполняются
    # ОКК при первом отборе материала и переиспользуются дальше. Не зависят
    # от объёма партии — определяются методиками анализа.
    sample_pc_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    sample_micro_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    sample_archive_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    sample_stability_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    sample_unit: Mapped[str | None] = mapped_column(String(32), nullable=True)


class Employee(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "employees"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    personnel_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    position: Mapped[str] = mapped_column(String(255), nullable=False)
