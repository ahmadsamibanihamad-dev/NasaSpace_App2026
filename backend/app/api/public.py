"""Observed environment (NASA POWER) for the dashboard and analytics, and system status."""

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from app.api.deps import current_user
from app.core.config import APP_NAME
from app.core.db import get_session
from app.engine.environment import RESOLUTIONS, VARIABLES, env_summary, time_series
from app.models import EnvCache, User
from app.services.climate import get_climate
from app.services.crops import CATALOG, load_crops
from app.services.geo import require_in_jordan

router = APIRouter()


def _rules_version() -> str:
    import json

    return json.loads(CATALOG.read_text(encoding="utf-8"))["version"]


# ---------------- environment (signed-in) ----------------


@router.get("/environment/summary", tags=["environment"])
def environment_summary(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180), _: User = Depends(current_user), session: Session = Depends(get_session)):
    require_in_jordan(lat, lon)
    return env_summary(get_climate(session, lat, lon), lat, lon)


@router.get("/environment/timeseries", tags=["environment"])
def environment_timeseries(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    variable: Literal["temperature", "rainfall", "soil_moisture", "humidity", "solar_radiation"] = "temperature",
    resolution: Literal["daily", "monthly", "seasonal", "annual"] = "monthly",
    _: User = Depends(current_user),
    session: Session = Depends(get_session),
):
    require_in_jordan(lat, lon)
    assert variable in VARIABLES and resolution in RESOLUTIONS
    return time_series(get_climate(session, lat, lon), variable, resolution)


# ---------------- system ----------------


@router.get("/health", tags=["system"])
def health():
    return {"ok": True, "app": APP_NAME, "recommendation_rules": _rules_version(), "crops": sorted(load_crops())}


@router.get("/data/status", tags=["system"])
def data_status(session: Session = Depends(get_session)):
    """Freshness of the cached NASA POWER record (dashboard and analytics) per cell."""
    rows = session.exec(select(EnvCache)).all()
    return {"sources": [{"source": r.source, "cell": r.cell, "latest_observation_date": r.last_date, "fetched_at": r.fetched_at} for r in rows]}
