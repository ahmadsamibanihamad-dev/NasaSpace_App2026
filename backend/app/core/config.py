import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"
DATA_DIR = APP_DIR / "data"

APP_NAME = {"en": "Ardna", "ar": "أرضنا"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # Security (JWT_SECRET must be set in .env for any real deployment)
    # If unset, a random secret is generated per process (tokens reset on restart).
    jwt_secret: str = Field(default_factory=lambda: secrets.token_urlsafe(48))
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'ardna.db').as_posix()}"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # NASA POWER
    power_base_url: str = "https://power.larc.nasa.gov/api/temporal/daily/point"
    power_history_years: int = 15
    power_timeout_s: float = 90.0
    # If true, never call external services (tests / offline demo); use cached or demo data.
    offline_mode: bool = False

    # Local store for ingested SMAP / IMERG tables (written by backend/scripts/*)
    data_store_dir: str = str(BACKEND_DIR / "data_store")

    # Recommendation engine selection
    engine: Literal["rules", "ml", "hybrid"] = "rules"
    model_path: str = str(APP_DIR / "ml" / "models" / "model.joblib")

    @field_validator("jwt_secret")
    @classmethod
    def _non_empty_secret(cls, v: str) -> str:
        return v or secrets.token_urlsafe(48)


@lru_cache
def get_settings() -> Settings:
    return Settings()
