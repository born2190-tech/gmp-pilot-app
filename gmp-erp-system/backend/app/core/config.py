from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://gmp_user:gmp_pass@127.0.0.1:5434/gmp_erp"
    secret_key: str = "dev-change-me"
    access_token_minutes: int = 720

    model_config = SettingsConfigDict(env_file=".env", env_prefix="GMP_")


settings = Settings()
