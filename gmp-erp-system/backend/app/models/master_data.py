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


class InventoryAccount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Бухгалтерский счёт учёта запасов (напр. «001-20»).

    Классифицирует запасы по виду материала/стадии (АФИ, вспомогательные,
    упаковочные и т.д.), не равен физическому складу: в одном складе могут
    лежать материалы на разных счетах. Используется для стоимостной
    оборотной ведомости и переноса стоимости при перемещении (АФИ → цех)."""

    __tablename__ = "inventory_accounts"

    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Группа (вид): SUBSTANCE_API | EXCIPIENT | PACKAGING | WIP | OTHER
    account_group: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Зона качества: QUARANTINE | RELEASED | REJECTED | WIP | None.
    # Счёт определяется парой (account_group, zone); при смене зоны партии
    # (приём → допуск → брак / цех) стоимость переносится с счёта на счёт.
    zone: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)


class Material(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "materials"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    item_type: Mapped[str] = mapped_column(String(64), nullable=False)
    # Тип вторичного упаковочного материала (ВУМ) для подбора методов входного
    # контроля по СОП-543: label | carton | corrugated_box | leaflet. NULL —
    # не упаковка или тип не задан (определяется эвристикой по названию).
    packaging_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    default_unit: Mapped[str] = mapped_column(String(32), nullable=False)
    # Счёт учёта по виду материала (АФИ/вспомогательные/упаковочные). Партия
    # при приёмке наследует этот счёт; далее счёт может меняться перемещением.
    account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("inventory_accounts.id"), nullable=True)
    # Вид материала для подбора счёта по зоне: SUBSTANCE_API | EXCIPIENT | PACKAGING.
    account_group: Mapped[str | None] = mapped_column(String(32), nullable=True)
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
