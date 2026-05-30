from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

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

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
