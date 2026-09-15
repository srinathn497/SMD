from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    DATABASE_URL: str = "sqlite+aiosqlite:///./smd.db"
    ALERT_CHECK_INTERVAL_SECONDS: int = 60
    PRICE_POLL_INTERVAL_SECONDS: int = 10
    ML_RETRAIN_INTERVAL_HOURS: int = 168
    CORS_ORIGINS: str = "http://localhost:5173"

    # Email / SMTP — set SMTP_ENABLED=true and fill credentials in .env to activate
    SMTP_ENABLED: bool = False
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    ALERT_EMAIL_TO: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]


settings = Settings()
