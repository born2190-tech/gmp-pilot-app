"""Акт отбора средней пробы — СОП-533 Ф-10 (сырьё/упаковка) и
СОП-548 Ф-10 (готовая продукция).

Жизненный цикл: draft → scan_uploaded → verified | cancelled.

Бизнес-правила:
* строго один акт на партию (повторный отбор — отдельный сценарий);
* форма (533/548) определяется автоматически по типу склада партии;
* при `post` (подпись ОКК после загрузки скана) атомарно:
    - lot.quantity -= сумма проб
    - lot.sampling_date = now
    - InventoryMovement(type=SAMPLING, -total)
    - статус акта → verified
* пока акт не `verified` — лабораторный анализ по партии заблокирован
  (см. quality.py: _require_verified_sampling_act).
"""
from __future__ import annotations

import hashlib
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.core.config import settings
from app.models.identity import User
from app.models.inventory import InventoryMovement, Lot
from app.models.master_data import Manufacturer, Material, Warehouse
from app.models.quality import SamplingAct, SamplingLine, SamplingScan
from app.schemas.quality import SamplingActCreate
from app.services.audit import write_audit
from app.services.document_qr import DOC_SAMPLING_ACT, canonical_hash, validate_scan_document_qr
from app.services.permissions import require_any_permission, require_permission
from app.services.signature import validate_signature


SCAN_MAX_BYTES = 10 * 1024 * 1024  # 10 MiB
SCAN_MIMES = {"image/jpeg", "image/jpg", "image/png", "application/pdf"}

# Назначения проб, которые физически списываются с партии.
DEBIT_PURPOSES = {"PHYSICOCHEMICAL", "MICROBIOLOGICAL", "ARCHIVE", "STABILITY"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _scan_root() -> Path:
    # Под смонтированным томом (qc_scan_root = /data/qc-scans), иначе сканы
    # терялись при пересборке контейнера (писались в эфемерный /data).
    return Path(settings.qc_scan_root).resolve() / "sampling-act-scans"


def _safe_seg(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value)[:64]


def sop_form_for_warehouse(warehouse_type: str | None) -> str:
    """FG-склад → 548, остальные → 533."""
    return "548" if warehouse_type == "FG_WAREHOUSE" else "533"


def _generate_act_no(db: Session) -> str:
    today = now_utc().strftime("%Y%m%d")
    base = f"SMPL-{today}"
    last = (
        db.query(SamplingAct.act_no)
        .filter(SamplingAct.act_no.like(f"{base}-%"))
        .order_by(SamplingAct.act_no.desc())
        .limit(1)
        .scalar()
    )
    seq = 1
    if last:
        try:
            seq = int(last.rsplit("-", 1)[-1]) + 1
        except ValueError:
            seq = 1
    return f"{base}-{seq:03d}"


def compute_sampling_act_state_hash(act: SamplingAct) -> str:
    payload = {
        "act_no": act.act_no,
        "lot_id": str(act.lot_id),
        "sop_form": act.sop_form,
        "head_qc_user_id": str(act.head_qc_user_id) if act.head_qc_user_id else None,
        "warehouse_member_user_id": str(act.warehouse_member_user_id) if act.warehouse_member_user_id else None,
        "qc_representative_user_id": str(act.qc_representative_user_id) if act.qc_representative_user_id else None,
        "sampling_date": act.sampling_date.isoformat() if act.sampling_date else None,
        "sampling_location": act.sampling_location,
        "sample_condition": act.sample_condition,
        "temperature_c": act.temperature_c,
        "humidity_pct": act.humidity_pct,
        "scale_model": act.scale_model,
        "scale_calibration_no": act.scale_calibration_no,
        "transport_with_ice": act.transport_with_ice,
        "specification_ref": act.specification_ref,
        "registration_no": act.registration_no,
        "containers_outer_total": act.containers_outer_total,
        "containers_outer_sampled": act.containers_outer_sampled,
        "containers_inner_total": act.containers_inner_total,
        "containers_inner_sampled": act.containers_inner_sampled,
        "notes": act.notes,
        "lines": [
            {
                "purpose": line.purpose,
                "quantity": line.quantity,
                "unit": line.unit,
            }
            for line in sorted(act.lines, key=lambda item: ((item.created_at.isoformat() if item.created_at else ""), str(item.id)))
        ],
    }
    return canonical_hash(payload)


def multistep_sample_count(total: int | None) -> int | None:
    """Формула отбора СОП-548 §6.4: n = ⌈0.4·√n_тот⌉, ограничено 3..30."""
    if not total or total <= 0:
        return None
    return max(3, min(30, math.ceil(0.4 * math.sqrt(total))))


# ---------------------------------------------------------------------------

def _get_lot(db: Session, lot_id: UUID) -> Lot:
    lot = db.get(Lot, lot_id)
    if not lot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lot not found")
    return lot


def _apply_fields(act: SamplingAct, payload: SamplingActCreate) -> None:
    act.head_qc_user_id = payload.head_qc_user_id
    act.warehouse_member_user_id = payload.warehouse_member_user_id
    act.qc_representative_user_id = payload.qc_representative_user_id
    act.sampling_date = payload.sampling_date
    act.sampling_location = (payload.sampling_location or "").strip() or None
    act.sample_condition = (payload.sample_condition or "").strip() or None
    act.temperature_c = payload.temperature_c
    act.humidity_pct = payload.humidity_pct
    act.scale_model = (payload.scale_model or "").strip() or None
    act.scale_calibration_no = (payload.scale_calibration_no or "").strip() or None
    act.transport_with_ice = bool(payload.transport_with_ice)
    act.specification_ref = (payload.specification_ref or "").strip() or None
    act.registration_no = (payload.registration_no or "").strip() or None
    act.containers_outer_total = payload.containers_outer_total
    act.containers_outer_sampled = payload.containers_outer_sampled
    act.containers_inner_total = payload.containers_inner_total
    act.containers_inner_sampled = payload.containers_inner_sampled
    act.notes = (payload.notes or "").strip() or None


def _replace_lines(db: Session, act: SamplingAct, payload: SamplingActCreate) -> None:
    for existing in list(act.lines):
        db.delete(existing)
    act.lines = []
    db.flush()
    for line in payload.lines:
        db.add(
            SamplingLine(
                sampling_act_id=act.id,
                purpose=line.purpose,
                quantity=line.quantity,
                unit=line.unit.strip(),
            )
        )


def _learn_norms(db: Session, lot: Lot, payload: SamplingActCreate) -> None:
    """Запоминаем нормы отбора в карточке материала (оцифровка Ф-1).

    Пишем только если соответствующая норма в материале ещё пуста —
    т.е. «первый раз ОКК ввёл → система запомнила». Дальнейшие правки
    под конкретную партию стандарт не перезаписывают.
    """
    material = db.get(Material, lot.material_id)
    if not material:
        return
    by_purpose = {ln.purpose: ln for ln in payload.lines}
    mapping = {
        "PHYSICOCHEMICAL": "sample_pc_qty",
        "MICROBIOLOGICAL": "sample_micro_qty",
        "ARCHIVE": "sample_archive_qty",
        "STABILITY": "sample_stability_qty",
    }
    learned = False
    for purpose, attr in mapping.items():
        ln = by_purpose.get(purpose)
        if ln and ln.quantity and getattr(material, attr) in (None, 0):
            setattr(material, attr, ln.quantity)
            learned = True
    if not material.sample_unit:
        any_line = next((ln for ln in payload.lines if ln.unit), None)
        if any_line:
            material.sample_unit = any_line.unit.strip()
            learned = True
    if learned:
        db.add(material)


def create_sampling_act(db: Session, user: CurrentUser, payload: SamplingActCreate) -> SamplingAct:
    require_permission(user, "ENTER_QC_RESULT")
    lot = _get_lot(db, payload.lot_id)

    existing = (
        db.query(SamplingAct)
        .filter(SamplingAct.lot_id == lot.id, SamplingAct.status != "cancelled")
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Sampling act already exists for this lot: {existing.act_no}",
        )

    warehouse = db.get(Warehouse, lot.warehouse_id)
    sop_form = sop_form_for_warehouse(warehouse.warehouse_type if warehouse else None)

    act = SamplingAct(
        act_no=_generate_act_no(db),
        lot_id=lot.id,
        sop_form=sop_form,
        status="draft",
        created_by=user.id,
    )
    _apply_fields(act, payload)
    db.add(act)
    db.flush()
    _replace_lines(db, act, payload)
    _learn_norms(db, lot, payload)
    write_audit(
        db,
        user,
        object_type="sampling_act",
        object_id=str(act.id),
        action_type="CREATE_SAMPLING_ACT",
        new_value={"act_no": act.act_no, "lot_id": str(lot.id), "sop_form": sop_form},
    )
    db.commit()
    db.refresh(act)
    return act


def update_sampling_act(db: Session, user: CurrentUser, act_id: UUID, payload: SamplingActCreate) -> SamplingAct:
    require_permission(user, "ENTER_QC_RESULT")
    act = _get(db, act_id)
    if act.status == "verified":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Verified act cannot be edited")
    _apply_fields(act, payload)
    _replace_lines(db, act, payload)
    lot = db.get(Lot, act.lot_id)
    if lot:
        _learn_norms(db, lot, payload)
    write_audit(
        db,
        user,
        object_type="sampling_act",
        object_id=str(act.id),
        action_type="UPDATE_SAMPLING_ACT",
        new_value={"act_no": act.act_no},
    )
    db.commit()
    db.refresh(act)
    return act


def _get(db: Session, act_id: UUID) -> SamplingAct:
    act = db.get(SamplingAct, act_id)
    if not act:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sampling act not found")
    return act


def get_sampling_act(db: Session, user: CurrentUser, act_id: UUID) -> SamplingAct:
    require_permission(user, "VIEW_QC")
    return _get(db, act_id)


def cancel_sampling_act(db: Session, user: CurrentUser, act_id: UUID) -> SamplingAct:
    """Отмена черновика/загруженного скана акта (до подтверждения).

    Подтверждённый (verified) акт отменить нельзя — он уже списал пробу
    с партии; для отмены потребовалось бы сторнирующее движение, что вне
    обычного сценария. Отмена возвращает партию в исходное состояние:
    черновик не списывал — поэтому достаточно сменить статус.
    """
    require_permission(user, "ENTER_QC_RESULT")
    act = _get(db, act_id)
    if act.status == "verified":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Подтверждённый акт нельзя отменить — проба уже списана с партии",
        )
    if act.status == "cancelled":
        return act
    act.status = "cancelled"
    write_audit(
        db,
        user,
        object_type="sampling_act",
        object_id=str(act.id),
        action_type="CANCEL_SAMPLING_ACT",
        new_value={"act_no": act.act_no, "status": "cancelled"},
    )
    db.commit()
    db.refresh(act)
    return act


def get_act_for_lot(db: Session, lot_id: UUID) -> SamplingAct | None:
    return (
        db.query(SamplingAct)
        .filter(SamplingAct.lot_id == lot_id, SamplingAct.status != "cancelled")
        .order_by(SamplingAct.created_at.desc())
        .first()
    )


def list_sampling_acts(db: Session, user: CurrentUser, status_filter: str | None = None) -> list[SamplingAct]:
    require_permission(user, "VIEW_QC")
    q = db.query(SamplingAct).order_by(SamplingAct.created_at.desc())
    if status_filter:
        q = q.filter(SamplingAct.status == status_filter)
    return q.all()


# ---------------------------------------------------------------------------

async def upload_scan(db: Session, user: CurrentUser, act_id: UUID, file: UploadFile) -> SamplingScan:
    require_permission(user, "ENTER_QC_RESULT")
    act = _get(db, act_id)
    if act.status == "verified":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Act is already verified")
    if file.content_type not in SCAN_MIMES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG or PDF scans are accepted",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(raw) > SCAN_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Scan exceeds 10 MiB limit")

    validate_scan_document_qr(
        raw=raw,
        mime_type=file.content_type,
        expected_doc_type=DOC_SAMPLING_ACT,
        expected_document_id=act.id,
        expected_lot_id=act.lot_id,
        expected_state_hash=compute_sampling_act_state_hash(act),
    )

    sha = hashlib.sha256(raw).hexdigest()
    when = now_utc()
    folder = _scan_root() / str(when.year) / f"{when.month:02d}" / _safe_seg(str(act.id))
    folder.mkdir(parents=True, exist_ok=True)
    ext = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "application/pdf": "pdf"}.get(
        file.content_type or "", "bin"
    )
    file_path = folder / f"{when.strftime('%Y%m%dT%H%M%S')}-{sha[:8]}.{ext}"
    file_path.write_bytes(raw)

    version = (
        db.query(SamplingScan)
        .filter(SamplingScan.sampling_act_id == act.id)
        .count()
        + 1
    )
    scan = SamplingScan(
        sampling_act_id=act.id,
        version=version,
        file_path=str(file_path),
        mime_type=file.content_type or "application/octet-stream",
        file_size=len(raw),
        sha256_hash=sha,
        uploaded_by=user.id,
        uploaded_at=when,
    )
    db.add(scan)
    if act.status == "draft":
        act.status = "scan_uploaded"
    write_audit(
        db,
        user,
        object_type="sampling_act",
        object_id=str(act.id),
        action_type="UPLOAD_SAMPLING_SCAN",
        new_value={"act_no": act.act_no, "sha256": sha, "size": len(raw), "version": version},
    )
    db.commit()
    db.refresh(scan)
    return scan


def list_scans(db: Session, act_id: UUID) -> list[SamplingScan]:
    return (
        db.query(SamplingScan)
        .filter(SamplingScan.sampling_act_id == act_id)
        .order_by(SamplingScan.version.desc())
        .all()
    )


def load_scan_file(db: Session, user: CurrentUser, scan_id: UUID) -> tuple[bytes, str]:
    # Просмотр скана акта отбора (Ф-10): загрузивший (ОКК), верификатор ДОК и
    # просматривающие роли. Раньше требовался только VIEW_QC — из-за чего ДОК
    # не мог открыть отсканированный акт для верификации.
    require_any_permission(user, ("VERIFY_QC_SCAN", "ENTER_QC_RESULT", "VIEW_QC", "VIEW_QA", "VIEW_WAREHOUSE"))
    scan = db.get(SamplingScan, scan_id)
    if not scan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
    path = Path(scan.file_path)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Scan file missing on disk")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != scan.sha256_hash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan integrity check failed (sha256 mismatch)")
    return raw, scan.mime_type


# ---------------------------------------------------------------------------
# ДОК (QA) 4-eyes verification of the wet-ink-signed sampling act (Ф-10).
# Must happen BEFORE the ОКК posts the act (debits the sample) — see
# post_sampling_act, which gates on the latest scan being verified.
# ---------------------------------------------------------------------------

def latest_scan(db: Session, act_id: UUID) -> SamplingScan | None:
    return (
        db.query(SamplingScan)
        .filter(SamplingScan.sampling_act_id == act_id)
        .order_by(SamplingScan.version.desc())
        .first()
    )


def is_act_scan_verified(db: Session, act_id: UUID) -> bool:
    last = latest_scan(db, act_id)
    return bool(last and last.status == "verified")


def verify_sampling_scan(
    db: Session,
    user: CurrentUser,
    scan_id: UUID,
    *,
    signature_1_ok: bool,
    signature_2_ok: bool,
    signature_3_ok: bool,
    remarks: str | None,
    username: str,
    password: str,
    meaning: str,
    reason: str | None,
) -> SamplingScan:
    require_permission(user, "VERIFY_QC_SCAN")
    scan = db.get(SamplingScan, scan_id)
    if not scan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
    if scan.status != "pending_verification":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan is not pending verification")
    if scan.uploaded_by == user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user who uploaded the scan cannot verify it (4-eyes rule)",
        )
    if not (signature_1_ok and signature_2_ok and signature_3_ok):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All three wet-ink signatures must be confirmed to verify the scan",
        )

    from app.schemas.inventory import SignatureRequest

    signature = SignatureRequest(username=username, password=password, meaning=meaning, reason=reason)
    validate_signature(db, user, signature, "VERIFY_SAMPLING_SCAN", "sampling_scan", str(scan.id))

    act = db.get(SamplingAct, scan.sampling_act_id)
    scan.status = "verified"
    scan.verified_by = user.id
    scan.verified_at = now_utc()
    scan.signature_1_ok = signature_1_ok
    scan.signature_2_ok = signature_2_ok
    scan.signature_3_ok = signature_3_ok
    scan.remarks = (remarks or "").strip() or None
    write_audit(
        db,
        user,
        object_type="sampling_scan",
        object_id=str(scan.id),
        action_type="VERIFY_SAMPLING_SCAN",
        new_value={"act_no": act.act_no if act else None, "version": scan.version, "remarks": scan.remarks},
        reason=reason,
    )
    db.commit()
    db.refresh(scan)
    return scan


def reject_sampling_scan(
    db: Session,
    user: CurrentUser,
    scan_id: UUID,
    *,
    remarks: str,
    username: str,
    password: str,
    meaning: str,
    reason: str | None,
) -> SamplingScan:
    require_permission(user, "VERIFY_QC_SCAN")
    scan = db.get(SamplingScan, scan_id)
    if not scan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
    if scan.status != "pending_verification":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan is not pending verification")
    if scan.uploaded_by == user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user who uploaded the scan cannot reject it either — escalate to another QA officer",
        )
    if not remarks.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rejection requires remarks")

    from app.schemas.inventory import SignatureRequest

    signature = SignatureRequest(username=username, password=password, meaning=meaning, reason=reason)
    validate_signature(db, user, signature, "REJECT_SAMPLING_SCAN", "sampling_scan", str(scan.id))

    act = db.get(SamplingAct, scan.sampling_act_id)
    scan.status = "rejected"
    scan.verified_by = user.id
    scan.verified_at = now_utc()
    scan.remarks = remarks.strip()
    # Откат акта в draft, чтобы ДКК загрузил чистый скан.
    has_other_pending = (
        db.query(SamplingScan.id)
        .filter(
            SamplingScan.sampling_act_id == scan.sampling_act_id,
            SamplingScan.id != scan.id,
            SamplingScan.status == "pending_verification",
        )
        .first()
    )
    if act and not has_other_pending and act.status == "scan_uploaded":
        act.status = "draft"
    write_audit(
        db,
        user,
        object_type="sampling_scan",
        object_id=str(scan.id),
        action_type="REJECT_SAMPLING_SCAN",
        new_value={"act_no": act.act_no if act else None, "version": scan.version, "remarks": scan.remarks},
        reason=reason,
    )
    db.commit()
    db.refresh(scan)
    return scan


# ---------------------------------------------------------------------------

def post_sampling_act(db: Session, user: CurrentUser, act_id: UUID, payload) -> SamplingAct:
    """Подпись акта ОКК → списание проб с партии + движение SAMPLING."""
    require_permission(user, "ENTER_QC_RESULT")
    act = _get(db, act_id)
    if act.status == "verified":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Act already verified")
    if act.status != "scan_uploaded":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Upload the signed scan before confirming the act",
        )
    # ДОК (QA) должен подтвердить подписи на скане ДО списания пробы (4-eyes).
    if not is_act_scan_verified(db, act.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Скан акта отбора не верифицирован ДОК — подтверждение и списание пробы заблокировано",
        )
    if not act.lines:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Act has no sample lines")

    lot = _get_lot(db, act.lot_id)
    total = sum(line.quantity for line in act.lines if line.purpose in DEBIT_PURPOSES)
    if total <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Total sampled quantity must be > 0")
    if total > lot.quantity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Sampled quantity {total} exceeds lot remainder {lot.quantity}",
        )

    validate_signature(db, user, payload, "POST_SAMPLING_ACT", "sampling_act", str(act.id))

    old_qty = lot.quantity
    old_quality_status = lot.quality_status
    lot.quantity = old_qty - total
    lot.sampling_date = now_utc()
    # Акт отбора = факт физического отбора пробы. Переводим партию из
    # карантина в статус «отобрано», чтобы стал возможен лабораторный анализ.
    if lot.quality_status == "quarantine":
        lot.quality_status = "sampled"

    db.add(
        InventoryMovement(
            movement_type="SAMPLING",
            document_type="sampling_act",
            document_id=act.id,
            lot_id=lot.id,
            from_warehouse_id=lot.warehouse_id,
            from_location_id=lot.location_id,
            to_warehouse_id=lot.warehouse_id,
            to_location_id=lot.location_id,
            quantity_delta=-total,
            quantity_after=lot.quantity,
            unit=lot.unit,
            reason=f"Отбор средней пробы (СОП-{act.sop_form} Ф-10, акт {act.act_no})",
            user_id=user.id,
            workstation_id=user.workstation_id,
        )
    )
    act.status = "verified"
    act.posted_by = user.id
    act.posted_at = now_utc()
    write_audit(
        db,
        user,
        object_type="sampling_act",
        object_id=str(act.id),
        action_type="POST_SAMPLING_ACT",
        old_value={"lot_quantity": old_qty, "lot_quality_status": old_quality_status, "status": "scan_uploaded"},
        new_value={
            "lot_quantity": lot.quantity,
            "lot_quality_status": lot.quality_status,
            "sampled_total": total,
            "status": "verified",
        },
        reason=getattr(payload, "reason", None),
    )
    db.commit()
    db.refresh(act)
    return act


# ---------------------------------------------------------------------------

def _user_name(db: Session, user_id: UUID | None) -> str | None:
    if not user_id:
        return None
    u = db.get(User, user_id)
    return (u.full_name or u.username) if u else None


def build_item(db: Session, act: SamplingAct) -> dict:
    lot = db.get(Lot, act.lot_id)
    material = db.get(Material, lot.material_id) if lot else None
    manufacturer = db.get(Manufacturer, lot.manufacturer_id) if lot else None
    total = sum(l.quantity for l in act.lines if l.purpose in DEBIT_PURPOSES)
    return {
        "id": act.id,
        "act_no": act.act_no,
        "lot_id": act.lot_id,
        "qc_notification_id": act.qc_notification_id,
        "sop_form": act.sop_form,
        "status": act.status,
        "head_qc_user_id": act.head_qc_user_id,
        "warehouse_member_user_id": act.warehouse_member_user_id,
        "qc_representative_user_id": act.qc_representative_user_id,
        "head_qc_name": _user_name(db, act.head_qc_user_id),
        "warehouse_member_name": _user_name(db, act.warehouse_member_user_id),
        "qc_representative_name": _user_name(db, act.qc_representative_user_id),
        "sampling_date": act.sampling_date,
        "sampling_location": act.sampling_location,
        "sample_condition": act.sample_condition,
        "temperature_c": act.temperature_c,
        "humidity_pct": act.humidity_pct,
        "scale_model": act.scale_model,
        "scale_calibration_no": act.scale_calibration_no,
        "transport_with_ice": act.transport_with_ice,
        "specification_ref": act.specification_ref,
        "registration_no": act.registration_no,
        "containers_outer_total": act.containers_outer_total,
        "containers_outer_sampled": act.containers_outer_sampled,
        "containers_inner_total": act.containers_inner_total,
        "containers_inner_sampled": act.containers_inner_sampled,
        "notes": act.notes,
        "posted_at": act.posted_at,
        "created_at": act.created_at,
        "material_name": material.name if material else None,
        "material_code": material.code if material else None,
        "internal_lot": lot.internal_lot if lot else None,
        "supplier_lot": (lot.supplier_lot if lot else None) or None,
        "manufacturer_name": manufacturer.name if manufacturer else None,
        "lot_quantity": lot.quantity if lot else None,
        "lot_unit": lot.unit if lot else None,
        "total_sampled": total,
        "lines": list(act.lines),
        "scans": list_scans(db, act.id),
    }
