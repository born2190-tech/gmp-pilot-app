from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# Статус калибровки (агрегат по последней действующей записи):
# ok       — действует, валидно > 30 дней
# expiring — действует, но осталось <= 30 дней
# expired  — последняя калибровка просрочена
# missing  — записей о калибровке нет
CALIBRATION_STATUS_OK = "ok"
CALIBRATION_STATUS_EXPIRING = "expiring"
CALIBRATION_STATUS_EXPIRED = "expired"
CALIBRATION_STATUS_MISSING = "missing"

CALIBRATION_STATUSES = (
    CALIBRATION_STATUS_OK,
    CALIBRATION_STATUS_EXPIRING,
    CALIBRATION_STATUS_EXPIRED,
    CALIBRATION_STATUS_MISSING,
)


class EquipmentCalibrationCreate(BaseModel):
    certificate_no: str | None = Field(default=None, max_length=128)
    performed_by: str | None = Field(default=None, max_length=255)
    valid_from: date
    valid_until: date
    notes: str | None = Field(default=None, max_length=1000)


class EquipmentCalibrationItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    equipment_id: UUID
    certificate_no: str | None
    performed_by: str | None
    valid_from: date
    valid_until: date
    notes: str | None
    recorded_by: UUID | None
    recorded_at: datetime


class EquipmentCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    category: str | None = Field(default=None, max_length=64)
    manufacturer: str | None = Field(default=None, max_length=255)
    model: str | None = Field(default=None, max_length=128)
    serial_no: str | None = Field(default=None, max_length=128)
    location: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)


class EquipmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    category: str | None = Field(default=None, max_length=64)
    manufacturer: str | None = Field(default=None, max_length=255)
    model: str | None = Field(default=None, max_length=128)
    serial_no: str | None = Field(default=None, max_length=128)
    location: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    notes: str | None = Field(default=None, max_length=2000)


class EquipmentItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    category: str | None
    manufacturer: str | None
    model: str | None
    serial_no: str | None
    location: str | None
    is_active: bool
    notes: str | None
    # Производные поля по последней калибровке.
    calibration_status: str = CALIBRATION_STATUS_MISSING
    calibration_valid_until: date | None = None
    calibration_certificate_no: str | None = None


class EquipmentListResponse(BaseModel):
    equipment: list[EquipmentItem]


class EquipmentDetail(EquipmentItem):
    calibrations: list[EquipmentCalibrationItem] = Field(default_factory=list)
