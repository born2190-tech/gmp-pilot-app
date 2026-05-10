from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.models.master_data import Employee, Location, Manufacturer, Material, Supplier, Warehouse
from app.schemas.master_data import (
    EmployeesResponse,
    LocationsResponse,
    ManufacturerCreate,
    ManufacturerItem,
    ManufacturersResponse,
    MaterialCreate,
    MaterialItem,
    MaterialsResponse,
    SupplierCreate,
    SupplierItem,
    SuppliersResponse,
    WarehousesResponse,
)
from app.services.audit import write_audit
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


@router.post("/suppliers", response_model=SupplierItem, status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: SupplierCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SupplierItem:
    require_permission(current_user, "MANAGE_MASTER_DATA")
    code = payload.code.strip().upper()
    name = payload.name.strip()
    if db.query(Supplier).filter(Supplier.code == code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Supplier code already exists")

    supplier = Supplier(code=code, name=name)
    db.add(supplier)
    db.flush()
    write_audit(
        db,
        current_user,
        object_type="supplier",
        object_id=str(supplier.id),
        action_type="CREATE",
        new_value={"code": supplier.code, "name": supplier.name},
        reason="Master data supplier created",
    )
    db.commit()
    db.refresh(supplier)
    return SupplierItem.model_validate(supplier)


@router.get("/manufacturers", response_model=ManufacturersResponse)
def list_manufacturers(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ManufacturersResponse:
    require_permission(current_user, "VIEW_MASTER_DATA")
    return ManufacturersResponse(manufacturers=db.query(Manufacturer).order_by(Manufacturer.code).all())


@router.post("/manufacturers", response_model=ManufacturerItem, status_code=status.HTTP_201_CREATED)
def create_manufacturer(
    payload: ManufacturerCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ManufacturerItem:
    require_permission(current_user, "MANAGE_MASTER_DATA")
    code = payload.code.strip().upper()
    name = payload.name.strip()
    if db.query(Manufacturer).filter(Manufacturer.code == code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Manufacturer code already exists")

    manufacturer = Manufacturer(code=code, name=name)
    db.add(manufacturer)
    db.flush()
    write_audit(
        db,
        current_user,
        object_type="manufacturer",
        object_id=str(manufacturer.id),
        action_type="CREATE",
        new_value={"code": manufacturer.code, "name": manufacturer.name},
        reason="Master data manufacturer created",
    )
    db.commit()
    db.refresh(manufacturer)
    return ManufacturerItem.model_validate(manufacturer)


@router.get("/materials", response_model=MaterialsResponse)
def list_materials(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MaterialsResponse:
    require_permission(current_user, "VIEW_MASTER_DATA")
    return MaterialsResponse(materials=db.query(Material).order_by(Material.code).all())


@router.post("/materials", response_model=MaterialItem, status_code=status.HTTP_201_CREATED)
def create_material(
    payload: MaterialCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MaterialItem:
    require_permission(current_user, "MANAGE_MASTER_DATA")
    code = payload.code.strip().upper()
    name = payload.name.strip()
    item_type = payload.item_type.strip().upper()
    default_unit = payload.default_unit.strip()
    if db.query(Material).filter(Material.code == code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Material code already exists")

    material = Material(code=code, name=name, item_type=item_type, default_unit=default_unit)
    db.add(material)
    db.flush()
    write_audit(
        db,
        current_user,
        object_type="material",
        object_id=str(material.id),
        action_type="CREATE",
        new_value={
            "code": material.code,
            "name": material.name,
            "item_type": material.item_type,
            "default_unit": material.default_unit,
        },
        reason="Master data material created",
    )
    db.commit()
    db.refresh(material)
    return MaterialItem.model_validate(material)


@router.get("/employees", response_model=EmployeesResponse)
def list_employees(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> EmployeesResponse:
    require_permission(current_user, "VIEW_MASTER_DATA")
    return EmployeesResponse(employees=db.query(Employee).order_by(Employee.personnel_no).all())
