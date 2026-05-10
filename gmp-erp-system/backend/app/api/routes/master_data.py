from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.models.master_data import Employee, Location, Manufacturer, Material, Supplier, Warehouse
from app.schemas.master_data import (
    EmployeesResponse,
    LocationsResponse,
    ManufacturersResponse,
    MaterialsResponse,
    SuppliersResponse,
    WarehousesResponse,
)
from app.services.permissions import require_permission

router = APIRouter(prefix="/api/master-data", tags=["master-data"])


@router.get("/warehouses", response_model=WarehousesResponse)
def list_warehouses(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> WarehousesResponse:
    require_permission(current_user, "VIEW_MASTER_DATA")
    query = db.query(Warehouse).order_by(Warehouse.code)
    if current_user.warehouse_scope:
        query = query.filter(Warehouse.warehouse_type == current_user.warehouse_scope)
    return WarehousesResponse(warehouses=query.all())


@router.get("/locations", response_model=LocationsResponse)
def list_locations(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> LocationsResponse:
    require_permission(current_user, "VIEW_MASTER_DATA")
    query = db.query(Location).join(Warehouse, Warehouse.id == Location.warehouse_id).order_by(Warehouse.code, Location.code)
    if current_user.warehouse_scope:
        query = query.filter(Warehouse.warehouse_type == current_user.warehouse_scope)
    return LocationsResponse(locations=query.all())


@router.get("/suppliers", response_model=SuppliersResponse)
def list_suppliers(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SuppliersResponse:
    require_permission(current_user, "VIEW_MASTER_DATA")
    return SuppliersResponse(suppliers=db.query(Supplier).order_by(Supplier.code).all())


@router.get("/manufacturers", response_model=ManufacturersResponse)
def list_manufacturers(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ManufacturersResponse:
    require_permission(current_user, "VIEW_MASTER_DATA")
    return ManufacturersResponse(manufacturers=db.query(Manufacturer).order_by(Manufacturer.code).all())


@router.get("/materials", response_model=MaterialsResponse)
def list_materials(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MaterialsResponse:
    require_permission(current_user, "VIEW_MASTER_DATA")
    return MaterialsResponse(materials=db.query(Material).order_by(Material.code).all())


@router.get("/employees", response_model=EmployeesResponse)
def list_employees(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> EmployeesResponse:
    require_permission(current_user, "VIEW_MASTER_DATA")
    return EmployeesResponse(employees=db.query(Employee).order_by(Employee.personnel_no).all())
