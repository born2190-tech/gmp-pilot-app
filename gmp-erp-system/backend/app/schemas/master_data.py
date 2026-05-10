from uuid import UUID

from pydantic import BaseModel, ConfigDict


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


class SuppliersResponse(BaseModel):
    suppliers: list[SupplierItem]


class ManufacturerItem(OrmModel):
    id: UUID
    code: str
    name: str


class ManufacturersResponse(BaseModel):
    manufacturers: list[ManufacturerItem]


class MaterialItem(OrmModel):
    id: UUID
    code: str
    name: str
    item_type: str
    default_unit: str


class MaterialsResponse(BaseModel):
    materials: list[MaterialItem]


class EmployeeItem(OrmModel):
    id: UUID
    user_id: UUID
    personnel_no: str
    position: str


class EmployeesResponse(BaseModel):
    employees: list[EmployeeItem]
