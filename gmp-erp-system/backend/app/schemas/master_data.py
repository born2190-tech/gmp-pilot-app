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
    default_unit: str


class MaterialCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    item_type: str = Field(min_length=1, max_length=64)
    default_unit: str = Field(min_length=1, max_length=32)


class MaterialsResponse(BaseModel):
    materials: list[MaterialItem]


class EmployeeItem(OrmModel):
    id: UUID
    user_id: UUID
    personnel_no: str
    position: str


class EmployeesResponse(BaseModel):
    employees: list[EmployeeItem]
