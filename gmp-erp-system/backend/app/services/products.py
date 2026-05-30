"""Справочник продуктов (ЛС) для производства (СОП-409)."""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import Product
from app.schemas.production import ProductCreate, ProductUpdate
from app.services.audit import write_audit


def _require_any(user: CurrentUser, codes: tuple[str, ...]) -> None:
    if not any(c in user.permissions for c in codes):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"One of permissions {', '.join(codes)} is required",
        )


def list_products(db: Session, user: CurrentUser) -> list[Product]:
    _require_any(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "EXECUTE_BMR", "VIEW_QA", "QA_DECISION"))
    return db.query(Product).order_by(Product.code, Product.market_code).all()


def get_product(db: Session, product_id: UUID) -> Product:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


def create_product(db: Session, user: CurrentUser, payload: ProductCreate) -> Product:
    _require_any(user, ("MANAGE_PRODUCTION",))
    code = payload.code.strip()
    market_code = payload.market_code.strip().upper()
    if db.query(Product).filter(Product.code == code, Product.market_code == market_code).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Продукт с кодом {code} для рынка {market_code} уже существует",
        )
    product = Product(
        code=code,
        market_code=market_code,
        market_name=payload.market_name.strip(),
        name=payload.name.strip(),
        dosage_form=(payload.dosage_form or "").strip() or None,
        default_shelf_life_months=payload.default_shelf_life_months,
        batch_format=(payload.batch_format or "").strip() or None,
        is_active=payload.is_active,
        notes=payload.notes,
    )
    db.add(product)
    db.flush()
    write_audit(
        db, user, object_type="product", object_id=str(product.id),
        action_type="CREATE_PRODUCT",
        new_value={"code": product.code, "name": product.name},
    )
    db.commit()
    db.refresh(product)
    return product


def update_product(db: Session, user: CurrentUser, product_id: UUID, payload: ProductUpdate) -> Product:
    _require_any(user, ("MANAGE_PRODUCTION",))
    product = get_product(db, product_id)
    market_code = payload.market_code.strip().upper()
    duplicate = (
        db.query(Product)
        .filter(Product.code == product.code, Product.market_code == market_code, Product.id != product.id)
        .first()
    )
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Продукт с кодом {product.code} для рынка {market_code} уже существует",
        )
    product.market_code = market_code
    product.market_name = payload.market_name.strip()
    product.name = payload.name.strip()
    product.dosage_form = (payload.dosage_form or "").strip() or None
    product.default_shelf_life_months = payload.default_shelf_life_months
    product.batch_format = (payload.batch_format or "").strip() or None
    product.is_active = payload.is_active
    product.notes = payload.notes
    write_audit(
        db, user, object_type="product", object_id=str(product.id),
        action_type="UPDATE_PRODUCT",
        new_value={"code": product.code, "name": product.name, "is_active": product.is_active},
    )
    db.commit()
    db.refresh(product)
    return product
