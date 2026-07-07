from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://gmp_user:gmp_pass@127.0.0.1:5434/gmp_erp"
    secret_key: str = "dev-change-me"
    access_token_minutes: int = 720
    # Root directory for GMP true-copy scans of signed Ф-14 notifications.
    # Container mounts /data/qc-scans; local dev defaults to ./qc-scans.
    qc_scan_root: str = "./qc-scans"
    # Общий ключ для машинной интеграции маркировки (DataMatrix-генератор →
    # ERP). Пусто = интеграция отключена (эндпоинты /api/marking отвечают 503).
    marking_api_key: str = ""

    # --- Didox (ЭДО/ЭСФ, api-partners.didox.uz) ---
    # Всё пусто = интеграция выключена (эндпоинт выпуска ЭСФ отвечает 503).
    # partner_token выдаёт Didox под ИНН компании; login taxid+password — сессия.
    didox_base_url: str = "https://api-partners.didox.uz"
    didox_partner_token: str = ""
    didox_tax_id: str = ""
    didox_password: str = ""
    didox_environment: str = "development"
    # Реквизиты продавца для ЭСФ (наши).
    didox_seller_name: str = ""
    didox_seller_account: str = ""
    didox_seller_bank_id: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="GMP_")


settings = Settings()
