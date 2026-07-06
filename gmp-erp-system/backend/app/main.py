import shutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.routes.auth import router as auth_router
from app.api.routes.equipment import router as equipment_router
from app.api.routes.inventory import router as inventory_router
from app.api.routes.master_data import router as master_data_router
from app.api.routes.quality import router as quality_router
from app.api.routes.production import router as production_router
from app.api.routes.production import products_router
from app.api.routes.bmr import router as bmr_router
from app.api.routes.bmr import instances_router as bmr_instances_router
from app.api.routes.reagents import router as reagents_router
from app.api.routes.requisitions import router as requisitions_router
from app.api.routes.weighing_campaign import router as weighing_campaign_router
from app.api.routes.fg_transfer import router as fg_transfer_router
from app.core.database import SessionLocal
from app.services.seed import seed_foundation_data


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    db = SessionLocal()
    try:
        seed_foundation_data(db)
    finally:
        db.close()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="GMP ERP Platform", version="0.1.0", lifespan=lifespan)
    app.include_router(auth_router)
    app.include_router(master_data_router)
    app.include_router(inventory_router)
    app.include_router(quality_router)
    app.include_router(production_router)
    app.include_router(products_router)
    app.include_router(bmr_router)
    app.include_router(bmr_instances_router)
    app.include_router(requisitions_router)
    app.include_router(equipment_router)
    app.include_router(reagents_router)
    app.include_router(weighing_campaign_router)
    app.include_router(fg_transfer_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        # Лёгкий liveness-пробник (для healthcheck контейнера).
        return {"status": "ok"}

    @app.get("/health/ready")
    def health_ready() -> JSONResponse:
        """Readiness: доступность БД + свободное место на диске сканов.
        Возвращает 503, если БД недоступна или диск почти полон (<1 ГБ /
        <5 %)."""
        checks: dict[str, object] = {}
        ok = True
        # БД
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            checks["database"] = "ok"
        except Exception as exc:  # noqa: BLE001 — пробник не должен падать
            ok = False
            checks["database"] = f"error: {type(exc).__name__}"
        finally:
            db.close()
        # Диск под сканы/PDF (GMP true-copy)
        try:
            from app.core.config import settings
            root = getattr(settings, "qc_scan_root", "/data/qc-scans")
            usage = shutil.disk_usage(root if root else "/")
            free_gb = round(usage.free / 1_073_741_824, 2)
            free_pct = round(usage.free / usage.total * 100, 1) if usage.total else 0
            checks["scan_disk"] = {"free_gb": free_gb, "free_pct": free_pct}
            if free_gb < 1 or free_pct < 5:
                ok = False
                checks["scan_disk_status"] = "low"
        except Exception as exc:  # noqa: BLE001
            checks["scan_disk"] = f"unknown: {type(exc).__name__}"
        return JSONResponse(status_code=200 if ok else 503, content={"status": "ok" if ok else "degraded", "checks": checks})

    return app


app = create_app()
