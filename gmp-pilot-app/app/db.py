from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SQLITE_PATH = BASE_DIR / "data" / "gmp_pilot.db"
DEFAULT_DATABASE_URL = f"sqlite:///{DEFAULT_SQLITE_PATH.as_posix()}"


def get_database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


def get_sqlite_db_path(database_url: str | None = None) -> Path:
    url = database_url or get_database_url()
    parsed = urlparse(url)
    if parsed.scheme != "sqlite":
        raise RuntimeError("Current sqlite runtime requires sqlite DATABASE_URL")

    if parsed.netloc:
        raw_path = f"//{parsed.netloc}{parsed.path}"
    else:
        raw_path = parsed.path

    if raw_path in {"", "/"}:
        raise RuntimeError("Invalid sqlite DATABASE_URL path")

    normalized = Path(raw_path)
    if not normalized.is_absolute():
        normalized = (BASE_DIR / normalized).resolve()
    return normalized


DATABASE_URL = get_database_url()

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, future=True, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


class Base(DeclarativeBase):
    pass
