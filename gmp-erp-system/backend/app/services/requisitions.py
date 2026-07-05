"""Production Requisition service — FEFO allocation + issue logic."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import (
    InventoryMovement,
    Lot,
    ProductionBatch,
    ProductionRequisition,
    RequisitionAllocationLine,
    RequisitionLine,
)
from app.models.master_data import Material, Warehouse
from app.schemas.inventory import (
    AllocationUpdateRequest,
    IssueRequisitionRequest,
    RequisitionCreate,
)
from app.services.audit import write_audit
from app.services.permissions import require_permission
from app.services.signature import validate_signature


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _get_required(db: Session, model: type, object_id: uuid.UUID, label: str):
    row = db.get(model, object_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return row


def _require_any_permission(user: CurrentUser, permission_codes: tuple[str, ...]) -> None:
    if not any(permission_code in user.permissions for permission_code in permission_codes):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"One of permissions {', '.join(permission_codes)} is required",
        )


def view_scope_for(user: CurrentUser) -> str | None:
    """Тип склада, которым ограничено представление требования для данного
    пользователя. Производство/ДОК видят документ целиком (None); склад-
    пользователь — только свою часть (строки своего склада)."""
    if "VIEW_PRODUCTION" in user.permissions or "MANAGE_PRODUCTION" in user.permissions:
        return None
    return user.warehouse_scope or None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_warehouse_type(db: Session, material_id: uuid.UUID) -> str:
    """Determine which warehouse handles this material based on item_type."""
    material = _get_required(db, Material, material_id, "Material")
    from app.services.material_types import is_packaging_item_type
    if is_packaging_item_type(material.item_type):
        return "PACKAGING_WAREHOUSE"
    # substance, excipient, solvent, other raw → substance warehouse
    return "SUBSTANCE_WAREHOUSE"


def _fefo_allocate(
    db: Session,
    material_id: uuid.UUID,
    requested_qty: float,
    warehouse_type: str | None = None,
) -> list[tuple[Lot, float]]:
    """
    FEFO (First Expired First Out) allocation.
    Returns list of (lot, quantity_to_take) sorted by expiry_date ASC, then created_at ASC.
    May return less than requested if stock is insufficient.
    """
    lots = (
        db.query(Lot)
        .join(Warehouse, Lot.warehouse_id == Warehouse.id)
        .filter(
            Lot.material_id == material_id,
            Lot.quality_status == "released",
            Lot.quantity > 0,
        )
    )
    if warehouse_type:
        lots = lots.filter(Warehouse.warehouse_type == warehouse_type)
    lots = lots.order_by(Lot.expiry_date.asc(), Lot.created_at.asc()).all()

    remaining = requested_qty
    result: list[tuple[Lot, float]] = []
    for lot in lots:
        if remaining <= 0:
            break
        take = min(lot.quantity, remaining)
        result.append((lot, round(take, 6)))
        remaining = round(remaining - take, 6)

    return result


def _replace_draft_allocations_for_line(
    db: Session,
    req: ProductionRequisition,
    line: RequisitionLine,
) -> float:
    db.query(RequisitionAllocationLine).filter(
        RequisitionAllocationLine.requisition_line_id == line.id,
        RequisitionAllocationLine.status == "draft",
    ).delete()

    remaining_quantity = round(line.requested_quantity - _line_issued_total(db, line.id), 6)
    if remaining_quantity <= 0:
        return 0.0

    allocated_total = 0.0
    for lot, qty in _fefo_allocate(db, line.material_id, remaining_quantity, line.warehouse_type):
        db.add(RequisitionAllocationLine(
            requisition_id=req.id,
            requisition_line_id=line.id,
            lot_id=lot.id,
            warehouse_type=line.warehouse_type,
            allocated_quantity=qty,
            status="draft",
        ))
        allocated_total = round(allocated_total + qty, 6)
    return allocated_total


def _line_issued_total(db: Session, requisition_line_id: uuid.UUID) -> float:
    return round(
        db.query(func.sum(RequisitionAllocationLine.allocated_quantity))
        .filter(
            RequisitionAllocationLine.requisition_line_id == requisition_line_id,
            RequisitionAllocationLine.status == "issued",
        )
        .scalar() or 0.0,
        6,
    )


def _recalculate_requisition_status(db: Session, req: ProductionRequisition) -> None:
    lines = db.query(RequisitionLine).filter(RequisitionLine.requisition_id == req.id).all()
    for line in lines:
        line.issued_quantity = _line_issued_total(db, line.id)
        if line.issued_quantity >= line.requested_quantity:
            line.status = "issued"
        elif line.issued_quantity > 0:
            line.status = "partially_issued"
        else:
            line.status = "pending"

    if lines and all(line.status == "issued" for line in lines):
        req.status = "issued"
    elif any(line.status in ("issued", "partially_issued") for line in lines):
        req.status = "partially_issued"
    elif req.status == "submitted" or any(line.allocation_lines for line in lines):
        req.status = "processing"


# ---------------------------------------------------------------------------
# Create requisition (production side)
# ---------------------------------------------------------------------------

def _parse_qty(raw) -> float:
    try:
        return float(str(raw or "0").replace(" ", "").replace(" ", "").replace(",", ".") or 0)
    except (ValueError, TypeError):
        return 0.0


def _norm_material_key(raw: str | None) -> str:
    import re

    text = (raw or "").lower().replace("ё", "е")
    text = re.sub(r"\*+", " ", text)
    text = re.sub(r"[^a-zа-я0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _material_alias_code(name: str | None) -> str:
    key = _norm_material_key(name)
    aliases = [
        (("метформин", "гидрохлорид"), "API-MET"),
        (("ситаглиптин", "фосфат"), "API-SITA"),
        (("повидон",), "EXC-POV"),
        (("лаурил", "сульфат"), "EXC-SLS"),
        (("кроскармеллоз",), "EXC-SOD"),
        (("коллоид", "кремн"), "EXC-AEROSIL"),
        (("aerosil",), "EXC-AEROSIL"),
        (("микрокристаллическ", "целлюлоз"), "EXC-MCC"),
        (("pharmasel",), "EXC-MCC"),
        (("стеарат", "магни"), "EXC-MGST"),
        (("opadry", "blue"), "EXC-OPA-BLUE"),
        (("opadry",), "COAT-OPADRY"),
        (("очищенная", "вода"), "UTIL-WATER"),
    ]
    for needles, code in aliases:
        if all(needle in key for needle in needles):
            return code
    return ""


def _resolve_material_from_bmr_row(db: Session, row: dict) -> Material | None:
    code = row.get("material_code") or _material_alias_code(row.get("name"))
    if code:
        material = db.query(Material).filter(Material.code == code).first()
        if material:
            return material
    name_key = _norm_material_key(row.get("name"))
    if not name_key:
        return None
    materials = db.query(Material).all()
    by_name = {_norm_material_key(material.name): material for material in materials}
    if name_key in by_name:
        return by_name[name_key]
    name_tokens = set(name_key.split())
    for material_key, material in by_name.items():
        material_tokens = set(material_key.split())
        if name_tokens and material_tokens and (
            name_tokens.issubset(material_tokens) or material_tokens.issubset(name_tokens)
        ):
            return material
    return None


def prefill_requisition(db: Session, user: CurrentUser, batch_id: uuid.UUID) -> dict:
    """Автозаполнение требования по серии: реквизиты из production_batch + плановые
    количества из производственной формулы утверждённого BMR-шаблона.

    Лист распределения в BMR заполняется позже фактом складской выдачи (FEFO):
    серии сырья, номера аналитических листов и фактические кг.
    Возвращает черновик (оператор проверяет/правит и отправляет обычным create)."""
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION"))
    from app.models.inventory import BmrTemplate  # локально: избегаем цикла импорта

    batch = _get_required(db, ProductionBatch, batch_id, "Production batch")
    template = (
        db.query(BmrTemplate)
        .filter(BmrTemplate.product_id == batch.product_id, BmrTemplate.status == "approved")
        .order_by(BmrTemplate.version.desc())
        .first()
        if batch.product_id else None
    )
    agg: dict[str, dict] = {}
    order: list[str] = []
    if template:
        for section in template.sections:
            config = section.config or {}
            if config.get("kind") != "production_formula":
                continue
            for row in config.get("rows", []):
                if not row.get("name"):
                    continue
                material = _resolve_material_from_bmr_row(db, row)
                if not material or material.code == "UTIL-WATER":
                    continue
                qty = _parse_qty(row.get("per_series"))
                if qty <= 0:
                    continue
                key = str(material.id)
                if key not in agg:
                    agg[key] = {
                        "material_id": material.id,
                        "material_name": material.name,
                        "material_code": material.code,
                        "requested_quantity": 0.0,
                        "unit": material.default_unit or "kg",
                    }
                    order.append(key)
                agg[key]["requested_quantity"] = round(agg[key]["requested_quantity"] + qty, 6)
    return {
        "product_name": batch.product_name,
        "product_series": batch.batch_no,
        "production_date": batch.production_date,
        "production_order_no": batch.bmr_no,
        "production_batch_id": batch.id,
        "has_template": template is not None,
        "lines": [agg[k] for k in order],
    }


def verify_requisition_scan(db: Session, user: CurrentUser, requisition_id: uuid.UUID, raw: bytes, mime_type: str | None) -> ProductionRequisition:
    """Ф4: подтверждение передачи накладной сканом её КР-кода. Распознаёт QR из
    загруженного скана, сверяет тип/идентификатор/хэш состояния с выданной
    накладной и ставит отметку scan_verified."""
    import hashlib
    from app.services.document_qr import validate_scan_document_qr

    _require_any_permission(user, ("POST_RECEIPT", "VIEW_PRODUCTION", "MANAGE_PRODUCTION"))
    req = _get_required(db, ProductionRequisition, requisition_id, "Requisition")
    if req.status not in ("issued", "partially_issued"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Сканировать накладную можно только после её выдачи складом")
    state_hash = hashlib.sha256(f"{req.requisition_no}|{req.status}|{len(req.lines)}".encode("utf-8")).hexdigest()
    validate_scan_document_qr(
        raw=raw,
        mime_type=mime_type,
        expected_doc_type="requisition",
        expected_document_id=req.id,
        expected_state_hash=state_hash,
    )
    req.scan_verified_at = now_utc()
    req.scan_verified_by = user.id
    write_audit(
        db, user, object_type="production_requisition", object_id=str(req.id),
        action_type="VERIFY_REQUISITION_SCAN", new_value={"requisition_no": req.requisition_no},
    )
    db.commit()
    db.refresh(req)
    return req


def _spill_distribution_to_bmr(db: Session, req: ProductionRequisition, alloc_lines: list, user: CurrentUser) -> None:
    """Ф2: при выдаче накладной заполняет лист распределения BMR серии данными
    выданных партий — № серии сырья (supplier_lot), № аналит. листа (report_no)
    и подпись «Выдал (Склад)».

    Плановое количество остаётся в производственной формуле. Если FEFO выдаёт
    один материал несколькими складскими сериями, в экземпляр BMR добавляются
    дополнительные строки листа распределения. Вес нетто оператор заполняет
    вручную по факту взвешивания на планшете."""
    if not req.production_batch_id:
        return
    from app.models.inventory import BmrEntry, BmrInstance
    from app.models.identity import User
    from app.models.quality import QCReport

    instance = db.query(BmrInstance).filter(BmrInstance.production_batch_id == req.production_batch_id).first()
    if not instance:
        return
    section = next(
        (s for s in instance.sections
         if (s.config or {}).get("kind") == "distribution_list" and (s.config or {}).get("stage") == "weighing"),
        None,
    )
    if not section:
        return
    config = section.config or {}
    if not section.config:
        section.config = config

    def _dist_field_pack(name: str) -> list[dict]:
        return [
            {"label": f"{name} · № серии сырья", "type": "text"},
            {"label": f"{name} · № аналит. листа", "type": "text"},
            {"label": f"{name} · вес нетто", "type": "number", "unit": "кг"},
            {"label": f"{name} · Выдал (Склад)", "type": "signature_warehouse"},
            {"label": f"{name} · Проверил (ДП)", "type": "signature_operator"},
            {"label": f"{name} · Проверил (ДОК)", "type": "signature_qa"},
        ]

    # material_code → строки листа распределения в экземпляре BMR
    code_map: dict[str, list[dict]] = {}
    base = 0
    for group in config.get("groups", []):
        for item in group.get("items", []):
            code = item.get("material_code")
            if not code:
                material = _resolve_material_from_bmr_row(db, item)
                code = material.code if material else ""
                if code:
                    item["material_code"] = code
            if code:
                code_map.setdefault(code, []).append({"field_base": base, "item": item, "group": group})
            base += 6

    signer = db.get(User, user.id)
    signer_name = signer.full_name if signer else user.username
    now = now_utc()
    config_changed = False

    def _entry_value(field_index: int) -> dict | None:
        entry = (
            db.query(BmrEntry)
            .filter(BmrEntry.instance_id == instance.id, BmrEntry.section_id == section.id, BmrEntry.field_index == field_index)
            .first()
        )
        return entry.value if entry else None

    def _slot_is_empty(field_base: int) -> bool:
        value = _entry_value(field_base)
        return not value or value.get("v") in (None, "")

    def _append_distribution_slot(material: Material, source_slot: dict | None) -> dict:
        nonlocal base, config_changed
        groups = config.setdefault("groups", [])
        if source_slot:
            group = source_slot["group"]
            source_item = source_slot["item"]
            item = {
                "name": source_item.get("name") or material.name,
                "spec": source_item.get("spec") or "",
                "qty": source_item.get("qty") or "",
                "material_code": material.code,
                "generated_from_requisition": True,
            }
        else:
            if not groups:
                groups.append({"title": "Фактическая выдача склада", "items": []})
            group = groups[0]
            item = {
                "name": material.name,
                "spec": "",
                "qty": "",
                "material_code": material.code,
                "generated_from_requisition": True,
            }
        group.setdefault("items", []).append(item)
        config.setdefault("fields", []).extend(_dist_field_pack(item["name"]))
        slot = {"field_base": base, "item": item, "group": group}
        code_map.setdefault(material.code, []).append(slot)
        base += 6
        config_changed = True
        return slot

    def _set(field_index: int, value: dict) -> None:
        entry = (
            db.query(BmrEntry)
            .filter(BmrEntry.instance_id == instance.id, BmrEntry.section_id == section.id, BmrEntry.field_index == field_index)
            .first()
        )
        if entry and entry.value and (entry.value.get("signed_by") or entry.value.get("v") not in (None, "")):
            return  # уже заполнено/подписано — не трогаем
        if entry is None:
            entry = BmrEntry(instance_id=instance.id, section_id=section.id, field_index=field_index)
            db.add(entry)
        entry.value = value
        entry.filled_by = user.id
        entry.filled_at = now

    for alloc in alloc_lines:
        line = db.get(RequisitionLine, alloc.requisition_line_id)
        material = db.get(Material, line.material_id) if line else None
        if not material:
            continue
        targets = code_map.get(material.code)
        if not targets:
            targets = [_append_distribution_slot(material, None)]
        target = next((slot for slot in targets if _slot_is_empty(slot["field_base"])), None)
        if target is None:
            target = _append_distribution_slot(material, targets[0] if targets else None)
        lot = db.get(Lot, alloc.lot_id)
        supplier_lot = (lot.supplier_lot or lot.internal_lot) if lot else None
        qc = (
            db.query(QCReport)
            .filter(QCReport.lot_id == alloc.lot_id)
            .order_by(QCReport.submitted_at.desc().nullslast(), QCReport.created_at.desc())
            .first()
            if lot else None
        )
        report_no = qc.report_no if qc else None
        field_base = target["field_base"]
        if supplier_lot:
            _set(field_base + 0, {"v": supplier_lot, "source": "requisition", "requisition_no": req.requisition_no})
        if report_no:
            _set(field_base + 1, {"v": report_no, "source": "requisition", "requisition_no": req.requisition_no})
        _set(field_base + 3, {"signed_by": signer_name, "role": "warehouse", "signed_at": now.isoformat()})
    if config_changed:
        flag_modified(section, "config")
    db.flush()


def _spill_efficiency_to_bmr(db: Session, req: ProductionRequisition, alloc_lines: list, user: CurrentUser) -> None:
    """При FEFO-выдаче предзаполняет «Расчёт эффективности» BMR данными выданных
    лотов API: № серии (supplier_lot) + количественное содержание и % воды из
    аналитического листа (QCReportParameter). Поля остаются редактируемыми,
    заполненное/подписанное не перезатирается. A/B/C1 фронт считает сам."""
    if not req.production_batch_id:
        return
    from app.models.inventory import BmrEntry, BmrInstance
    from app.models.quality import QCReport, QCReportParameter
    from app.services.bmr import _is_efficiency_calculation_config

    instance = db.query(BmrInstance).filter(BmrInstance.production_batch_id == req.production_batch_id).first()
    if not instance:
        return
    section = next(
        (s for s in instance.sections if _is_efficiency_calculation_config(s.config or {}, s.title)),
        None,
    )
    if not section:
        return

    now = now_utc()

    def _set(field_index: int, v: str) -> None:
        entry = (
            db.query(BmrEntry)
            .filter(BmrEntry.instance_id == instance.id, BmrEntry.section_id == section.id, BmrEntry.field_index == field_index)
            .first()
        )
        if entry and entry.value and (entry.value.get("signed_by") or entry.value.get("v") not in (None, "")):
            return  # уже заполнено/подписано — не перезатираем
        if entry is None:
            entry = BmrEntry(instance_id=instance.id, section_id=section.id, field_index=field_index)
            db.add(entry)
        entry.value = {"v": v, "source": "requisition", "requisition_no": req.requisition_no}
        entry.filled_by = user.id
        entry.filled_at = now

    def _num_from(text: str | None) -> str | None:
        m = re.search(r"\d+(?:[.,]\d+)?", text or "")
        return m.group(0).replace(",", ".") if m else None

    # Поля секции (фикс. раскладка _efficiency_calculation_fields):
    # метформин: 0 партия, 1 содержание, 2 вода; ситаглиптин: 4, 5, 6.
    api_base = {"метформин": 0, "ситаглиптин": 4}

    for alloc in alloc_lines:
        line = db.get(RequisitionLine, alloc.requisition_line_id)
        material = db.get(Material, line.material_id) if line else None
        if not material:
            continue
        name_low = f"{material.name or ''} {material.code or ''}".lower()
        base = next((b for k, b in api_base.items() if k in name_low), None)
        if base is None:
            continue
        lot = db.get(Lot, alloc.lot_id)
        supplier_lot = (lot.supplier_lot or lot.internal_lot) if lot else None
        if supplier_lot:
            _set(base + 0, supplier_lot)
        qc = (
            db.query(QCReport)
            .filter(QCReport.lot_id == alloc.lot_id)
            .order_by(QCReport.submitted_at.desc().nullslast(), QCReport.created_at.desc())
            .first()
            if lot else None
        )
        if not qc:
            continue
        params = db.query(QCReportParameter).filter(QCReportParameter.report_id == qc.id).all()
        water_val = content_val = None
        for p in params:
            pn = (p.parameter_name or "").lower()
            if water_val is None and ("вода" in pn or "влаг" in pn or "water" in pn or "высушив" in pn):
                water_val = _num_from(p.result_value)
            elif content_val is None and ("количественное" in pn or "assay" in pn or "содержание" in pn):
                content_val = _num_from(p.result_value)
        if content_val:
            _set(base + 1, content_val)
        if water_val:
            _set(base + 2, water_val)
    db.flush()


def create_requisition(db: Session, user: CurrentUser, payload: RequisitionCreate) -> ProductionRequisition:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION"))

    # Auto-generate requisition number
    count = db.query(func.count(ProductionRequisition.id)).scalar() or 0
    req_no = f"REQ-{now_utc().strftime('%Y%m%d')}-{count + 1:04d}"

    # Привязка к производственной серии (СОП-409): реквизиты берём из серии.
    product_name = payload.product_name
    product_series = payload.product_series
    production_date = payload.production_date
    batch_id = None
    if payload.production_batch_id:
        batch = _get_required(db, ProductionBatch, payload.production_batch_id, "Production batch")
        batch_id = batch.id
        product_name = batch.product_name
        product_series = batch.batch_no
        production_date = batch.production_date

    req = ProductionRequisition(
        requisition_no=req_no,
        status="submitted",
        production_batch_id=batch_id,
        product_name=product_name,
        product_series=product_series,
        production_date=production_date,
        production_order_no=payload.production_order_no,
        notes=payload.notes,
        submitted_by=user.id,
        submitted_at=now_utc(),
    )
    db.add(req)
    db.flush()

    created_lines: list[RequisitionLine] = []
    for line in payload.lines:
        material = _get_required(db, Material, line.material_id, "Material")
        wh_type = _resolve_warehouse_type(db, line.material_id)
        req_line = RequisitionLine(
            requisition_id=req.id,
            material_id=line.material_id,
            requested_quantity=line.requested_quantity,
            unit=line.unit or material.default_unit,
            warehouse_type=wh_type,
            issued_quantity=0.0,
            status="pending",
        )
        db.add(req_line)
        created_lines.append(req_line)

    db.flush()
    allocated_lines = 0
    for req_line in created_lines:
        if _replace_draft_allocations_for_line(db, req, req_line) > 0:
            allocated_lines += 1

    if allocated_lines:
        req.status = "processing"

    write_audit(
        db, user,
        object_type="production_requisition",
        object_id=str(req.id),
        action_type="CREATE_REQUISITION",
        new_value={
            "requisition_no": req_no,
            "product_name": payload.product_name,
            "fefo_allocated_lines": allocated_lines,
        },
    )
    db.commit()
    db.refresh(req)
    return req


# ---------------------------------------------------------------------------
# FEFO auto-allocation (warehouse side)
# ---------------------------------------------------------------------------

def auto_allocate(db: Session, user: CurrentUser, requisition_id: uuid.UUID) -> ProductionRequisition:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "VIEW_WAREHOUSE"))
    req = _get_required(db, ProductionRequisition, requisition_id, "Requisition")
    if req.status not in ("submitted", "processing"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Requisition is not in a state that allows allocation")

    # Delete existing DRAFT allocation lines for this warehouse's scope only
    warehouse_scope = user.warehouse_scope
    lines = db.query(RequisitionLine).filter(RequisitionLine.requisition_id == req.id).all()
    for line in lines:
        if warehouse_scope and line.warehouse_type != warehouse_scope:
            continue
        db.query(RequisitionAllocationLine).filter(
            RequisitionAllocationLine.requisition_line_id == line.id,
            RequisitionAllocationLine.status == "draft",
        ).delete()

    db.flush()

    # Run FEFO for each line this warehouse handles
    for line in lines:
        if warehouse_scope and line.warehouse_type != warehouse_scope:
            continue
        if _line_issued_total(db, line.id) >= line.requested_quantity:
            line.status = "issued"
            continue
        _replace_draft_allocations_for_line(db, req, line)

    _recalculate_requisition_status(db, req)

    write_audit(
        db, user,
        object_type="production_requisition",
        object_id=str(req.id),
        action_type="AUTO_ALLOCATE",
        new_value={"method": "FEFO", "warehouse_scope": warehouse_scope},
    )
    db.commit()
    db.refresh(req)
    return req


# ---------------------------------------------------------------------------
# Manual allocation update (warehouse side)
# ---------------------------------------------------------------------------

def update_allocation(db: Session, user: CurrentUser, requisition_id: uuid.UUID, payload: AllocationUpdateRequest) -> ProductionRequisition:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "VIEW_WAREHOUSE"))
    req = _get_required(db, ProductionRequisition, requisition_id, "Requisition")
    if req.status not in ("submitted", "processing"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Requisition is not in processing state")

    warehouse_scope = user.warehouse_scope

    # Removals
    for alloc_id in payload.removals:
        alloc = db.get(RequisitionAllocationLine, alloc_id)
        if alloc and alloc.status == "draft":
            if warehouse_scope and alloc.warehouse_type != warehouse_scope:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify allocation for another warehouse")
            db.delete(alloc)

    # Updates
    for upd in payload.updates:
        alloc = db.get(RequisitionAllocationLine, upd.id)
        if not alloc or alloc.status != "draft":
            continue
        if warehouse_scope and alloc.warehouse_type != warehouse_scope:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify allocation for another warehouse")
        if upd.allocated_quantity <= 0:
            db.delete(alloc)
        else:
            lot = _get_required(db, Lot, alloc.lot_id, "Lot")
            if upd.allocated_quantity > lot.quantity:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Allocated quantity {upd.allocated_quantity} exceeds lot stock {lot.quantity} for lot {lot.internal_lot}",
                )
            alloc.allocated_quantity = upd.allocated_quantity

    # Additions
    for add in payload.additions:
        req_line = _get_required(db, RequisitionLine, add.requisition_line_id, "RequisitionLine")
        lot = _get_required(db, Lot, add.lot_id, "Lot")
        if lot.quality_status != "released":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Lot {lot.internal_lot} is not released")
        if add.allocated_quantity > lot.quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Allocated quantity exceeds lot stock {lot.quantity}",
            )
        if warehouse_scope and req_line.warehouse_type != warehouse_scope:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot add allocation for another warehouse")
        # Check for duplicate lot on same line
        existing = db.query(RequisitionAllocationLine).filter(
            RequisitionAllocationLine.requisition_line_id == req_line.id,
            RequisitionAllocationLine.lot_id == lot.id,
            RequisitionAllocationLine.status == "draft",
        ).first()
        if existing:
            existing.allocated_quantity = round(existing.allocated_quantity + add.allocated_quantity, 6)
        else:
            db.add(RequisitionAllocationLine(
                requisition_id=req.id,
                requisition_line_id=req_line.id,
                lot_id=lot.id,
                warehouse_type=req_line.warehouse_type,
                allocated_quantity=add.allocated_quantity,
                status="draft",
            ))

    write_audit(
        db, user,
        object_type="production_requisition",
        object_id=str(req.id),
        action_type="UPDATE_ALLOCATION",
        new_value={"warehouse_scope": warehouse_scope},
    )
    db.commit()
    db.refresh(req)
    return req


# ---------------------------------------------------------------------------
# Issue (sign + dispatch) — warehouse manager
# ---------------------------------------------------------------------------

def issue_requisition(db: Session, user: CurrentUser, requisition_id: uuid.UUID, payload: IssueRequisitionRequest) -> ProductionRequisition:
    require_permission(user, "POST_RECEIPT")  # warehouse manager level
    req = _get_required(db, ProductionRequisition, requisition_id, "Requisition")
    if req.status not in ("submitted", "processing"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Requisition is not ready for issue")

    warehouse_scope = user.warehouse_scope
    validate_signature(db, user, payload, "ISSUE_REQUISITION", "production_requisition", str(req.id))

    issued_time = now_utc()

    # Get draft allocation lines for this warehouse
    alloc_query = db.query(RequisitionAllocationLine).filter(
        RequisitionAllocationLine.requisition_id == req.id,
        RequisitionAllocationLine.status == "draft",
    )
    if warehouse_scope:
        alloc_query = alloc_query.filter(RequisitionAllocationLine.warehouse_type == warehouse_scope)

    alloc_lines = alloc_query.all()
    if not alloc_lines:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No allocation lines to issue for this warehouse")

    # Issue each allocation line
    for alloc in alloc_lines:
        lot = _get_required(db, Lot, alloc.lot_id, "Lot")
        if lot.quality_status != "released":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Lot {lot.internal_lot} is no longer released",
            )
        if alloc.allocated_quantity > lot.quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Allocated {alloc.allocated_quantity} exceeds available {lot.quantity} for lot {lot.internal_lot}",
            )

        quantity_before = lot.quantity
        lot.quantity = round(lot.quantity - alloc.allocated_quantity, 6)

        db.add(InventoryMovement(
            movement_type="ISSUE_PRODUCTION",
            document_type="production_requisition",
            document_id=req.id,
            lot_id=lot.id,
            from_warehouse_id=lot.warehouse_id,
            from_location_id=lot.location_id,
            to_warehouse_id=None,
            to_location_id=None,
            quantity_delta=-alloc.allocated_quantity,
            quantity_after=lot.quantity,
            unit=lot.unit,
            reason=payload.reason or f"Requisition {req.requisition_no}",
            user_id=user.id,
            workstation_id=user.workstation_id,
        ))

        alloc.status = "issued"
        alloc.issued_by = user.id
        alloc.issued_at = issued_time

    db.flush()
    _recalculate_requisition_status(db, req)
    _spill_distribution_to_bmr(db, req, alloc_lines, user)
    _spill_efficiency_to_bmr(db, req, alloc_lines, user)

    write_audit(
        db, user,
        object_type="production_requisition",
        object_id=str(req.id),
        action_type="ISSUE_REQUISITION",
        new_value={
            "warehouse_scope": warehouse_scope,
            "lines_issued": len(alloc_lines),
            "requisition_status": req.status,
        },
        reason=payload.reason,
    )
    db.commit()
    db.refresh(req)
    return req


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def list_requisitions(db: Session, user: CurrentUser, status_filter: str | None = None) -> list[ProductionRequisition]:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "VIEW_WAREHOUSE"))
    query = db.query(ProductionRequisition).order_by(ProductionRequisition.created_at.desc())
    if status_filter:
        query = query.filter(ProductionRequisition.status == status_filter)
    scope = view_scope_for(user)
    if scope:
        # Склад видит только требования, в которых есть строки его склада.
        query = query.filter(
            ProductionRequisition.lines.any(RequisitionLine.warehouse_type == scope)
        )
    return query.all()


def get_requisition(db: Session, user: CurrentUser, requisition_id: uuid.UUID) -> ProductionRequisition:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "VIEW_WAREHOUSE"))
    return _get_required(db, ProductionRequisition, requisition_id, "Requisition")


def list_requisitions_for_batch(db: Session, user: CurrentUser, batch_id: uuid.UUID) -> list[ProductionRequisition]:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "EXECUTE_BMR", "VIEW_WAREHOUSE", "VIEW_QA", "QA_DECISION"))
    return (
        db.query(ProductionRequisition)
        .filter(ProductionRequisition.production_batch_id == batch_id)
        .order_by(ProductionRequisition.created_at.desc())
        .all()
    )


def build_requisition_item(db: Session, req: ProductionRequisition, scope: str | None = None) -> dict:
    """Build full nested response dict with allocation details.

    Если задан ``scope`` (тип склада), возвращаются только строки этого склада
    — «часть требования» для склад-пользователя. Производство/ДОК получают
    документ целиком (scope=None)."""
    all_lines = list(req.lines)
    visible_lines = [l for l in all_lines if l.warehouse_type == scope] if scope else all_lines
    result_lines = []
    for line in visible_lines:
        material = db.get(Material, line.material_id)
        alloc_items = []
        for alloc in line.allocation_lines:
            lot = db.get(Lot, alloc.lot_id)
            if not lot:
                continue
            from app.models.master_data import Location
            loc = db.get(Location, lot.location_id)
            alloc_items.append({
                "id": alloc.id,
                "requisition_line_id": alloc.requisition_line_id,
                "lot_id": alloc.lot_id,
                "lot_internal_lot": lot.internal_lot,
                "lot_supplier_lot": lot.supplier_lot or "",
                "lot_expiry_date": lot.expiry_date,
                "lot_location_code": loc.code if loc else "",
                "lot_rack_no": lot.rack_no,
                "lot_sector_no": lot.sector_no,
                "lot_tier_no": lot.tier_no,
                "lot_place_no": lot.place_no,
                "lot_pallet_no": lot.pallet_no,
                "lot_available": lot.quantity,
                "warehouse_type": alloc.warehouse_type,
                "allocated_quantity": alloc.allocated_quantity,
                "status": alloc.status,
            })
        result_lines.append({
            "id": line.id,
            "material_id": line.material_id,
            "material_code": material.code if material else "",
            "material_name": material.name if material else "",
            "requested_quantity": line.requested_quantity,
            "issued_quantity": line.issued_quantity,
            "unit": line.unit,
            "warehouse_type": line.warehouse_type,
            "status": line.status,
            "allocation_lines": alloc_items,
        })
    batch_no = None
    if req.production_batch_id:
        batch = db.get(ProductionBatch, req.production_batch_id)
        batch_no = batch.batch_no if batch else None
    return {
        "id": req.id,
        "requisition_no": req.requisition_no,
        "status": req.status,
        "production_batch_id": req.production_batch_id,
        "batch_no": batch_no,
        "product_name": req.product_name,
        "product_series": req.product_series,
        "production_date": req.production_date,
        "production_order_no": req.production_order_no,
        "notes": req.notes,
        "submitted_at": req.submitted_at,
        "scan_verified_at": req.scan_verified_at,
        "created_at": req.created_at,
        "lines": result_lines,
        "view_scope": scope,
        "is_partial_view": bool(scope) and len(visible_lines) != len(all_lines),
        "total_lines": len(all_lines),
    }
