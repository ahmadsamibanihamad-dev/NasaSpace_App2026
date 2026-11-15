import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"
DATA_DIR = APP_DIR / "data"

APP_NAME = {"en": "AgriVision", "ar": "AgriVision"}


def _local_secret() -> str:
    """Random signing secret stored next to the database. Never logged, never committed."""
    f = BACKEND_DIR / ".jwt_secret"
    try:
        v = f.read_text(encoding="utf-8").strip()
        if len(v) >= 32:
            return v
    except OSError:
        pass
    v = secrets.token_urlsafe(48)
    try:
        f.write_text(v, encoding="utf-8")
    except OSError:
        pass  # read-only folder: fall back to a per-process secret
    return v


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # Security. If JWT_SECRET is unset, a random secret is generated once and kept in a local,
    # git-ignored file so that sessions survive a restart of the server.
    jwt_secret: str = Field(default_factory=lambda: _local_secret())
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'ardna.db').as_posix()}"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174"

    # NASA POWER (no key needed)
    power_base_url: str = "https://power.larc.nasa.gov/api/temporal/daily/point"
    power_history_years: int = 12
    power_timeout_s: float = 90.0
    power_cache_hours: int = 24
    # true = never call external services; use cached data only (tests / offline demo)
    offline_mode: bool = False

    # Rate limits (requests per minute per client)
    rate_limit_auth: int = 10
    rate_limit_guest: int = 12

    # AI forecasting models
    #   off        - no forecasts; recommendations use the historical climate record only
    #   mock       - clearly labelled demonstration forecasts, for building the UI
    #   production - real model artifacts from MODEL_DIR; never falls back to mock
    ai_mode: Literal["off", "mock", "production"] = "off"
    model_dir: str = str(APP_DIR / "ml" / "artifacts")

    @field_validator("jwt_secret")
    @classmethod
    def _non_empty_secret(cls, v: str) -> str:
        return v or _local_secret()


@lru_cache
def get_settings() -> Settings:
    return Settings()
