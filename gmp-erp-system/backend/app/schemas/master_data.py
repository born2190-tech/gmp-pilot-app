from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class WarehouseItem(OrmModel):
    id: UUID
    code: str
    name: str
    warehouse_type: str


class WarehousesResponse(BaseModel):
    warehouses: list[WarehouseItem]


class LocationItem(OrmModel):
    id: UUID
    warehouse_id: UUID
    code: str
    name: str
    storage_condition: str | None


class LocationsResponse(BaseModel):
    locations: list[LocationItem]


class SupplierItem(OrmModel):
    id: UUID
    code: str
    name: str


class SupplierCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)


class SuppliersResponse(BaseModel):
    suppliers: list[SupplierItem]


class ManufacturerItem(OrmModel):
    id: UUID
    code: str
    name: str


class ManufacturerCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)


class ManufacturersResponse(BaseModel):
    manufacturers: list[ManufacturerItem]


class MaterialItem(OrmModel):
    id: UUID
    code: str
    name: str
    item_type: str
    # Тип ВУМ/ПУМ для подбора методов входного контроля (label|carton|
    # corrugated_box|leaflet|foil). None — не упаковка / тип не задан.
    packaging_type: str | None = None
    default_unit: str


_PACKAGING_TYPE_PATTERN = "^(label|carton|corrugated_box|leaflet|foil)$"


class MaterialCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    item_type: str = Field(min_length=1, max_length=64)
    packaging_type: str | None = Field(default=None, pattern=_PACKAGING_TYPE_PATTERN)
    default_unit: str = Field(min_length=1, max_length=32)


class MaterialUpdate(BaseModel):
    # Обновление классификации упаковки (для уже созданных материалов).
    packaging_type: str | None = Field(default=None, pattern=_PACKAGING_TYPE_PATTERN)


class MaterialsResponse(BaseModel):
    materials: list[MaterialItem]


class EmployeeItem(OrmModel):
    id: UUID
    user_id: UUID
    personnel_no: str
    position: str


class EmployeesResponse(BaseModel):
    employees: list[EmployeeItem]
