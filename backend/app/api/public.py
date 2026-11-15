"""Crops, environment, guest recommendations and system status."""

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from app.api.deps import current_user
from app.api.schemas import GuestRecommendIn
from app.core.config import APP_NAME, get_settings
from app.core.db import get_session
from app.core.errors import AppError
from app.core.ratelimit import limit
from app.engine.config import ENGINE_VERSION, crop_list, crops
from app.engine.environment import RESOLUTIONS, VARIABLES, env_summary, time_series
from app.engine.run import recommend_for_location
from app.engine.suitability import PlotCtx
from app.ml.service import get_prediction_service
from app.models import EnvCache, User
from app.services.climate import get_climate
from app.services.geo import governorate_for, require_in_jordan

router = APIRouter()
_s = get_settings()


# ---------------- crops ----------------


@router.get("/crops", tags=["crops"])
def list_crops():
    """The crop knowledge base. Every value carries its source; needs_review marks values to confirm locally."""
    return crop_list()


@router.get("/crops/{crop_id}", tags=["crops"])
def get_crop(crop_id: str):
    c = crops().get(crop_id)
    if not c:
        raise AppError(404, "UNSUPPORTED_CROP", f"Unsupported crop '{crop_id}'", {"supported": sorted(crops())})
    return c


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


# ---------------- guests ----------------


@router.post("/guest/recommendations", tags=["guest"], dependencies=[Depends(limit("guest", _s.rate_limit_guest))])
def guest_recommendations(body: GuestRecommendIn, session: Session = Depends(get_session)):
    """A guest picks a location and gets what to grow. No account, no farm, nothing saved."""
    require_in_jordan(body.lat, body.lon)
    ctx = PlotCtx(body.irrigation_available, (body.irrigation_method or "surface") if body.irrigation_available else "none")
    out = recommend_for_location(get_climate(session, body.lat, body.lon), ctx)
    return {
        "location": {"lat": body.lat, "lon": body.lon, "governorate": governorate_for(body.lat, body.lon)},
        "irrigation_available": body.irrigation_available,
        "saved": False,
        **out,
    }


# ---------------- system ----------------


@router.get("/health", tags=["system"])
def health():
    return {"ok": True, "app": APP_NAME, "engine": ENGINE_VERSION, "ai_mode": _s.ai_mode}


@router.get("/models/status", tags=["system"])
def models_status():
    return get_prediction_service().status()


@router.get("/data/status", tags=["system"])
def data_status(session: Session = Depends(get_session)):
    """Freshness of the cached climate record per source and cell."""
    from app.api.outlook import outlook_status

    rows = session.exec(select(EnvCache)).all()
    st = outlook_status()
    return {
        # NASA POWER record fetched live for the six analyses, per 0.5-degree cell
        "sources": [{"source": r.source, "cell": r.cell, "latest_observation_date": r.last_date, "fetched_at": r.fetched_at} for r in rows],
        # The AI team's integrated dataset behind the forecasts and the crop ranking (a prepared file, not a live feed)
        "forecast_dataset": {
            "available": st["available"],
            "kind": "prepared historical dataset",
            "sources": ["NASA POWER", "NASA SMAP", "NASA GPM IMERG", "ISRIC SoilGrids", "Copernicus DEM GLO-30"],
            "default_forecast_origin": st["forecast_origin"],
            "planting_date_min": st["planting_date_min"],
            "planting_date_max": st["planting_date_max"],
            "full_history_installed": st["available"] and st["planting_date_min"] != st["planting_date_max"],
            "rule_version": st["rule_version"],
        },
        "not_integrated": [],
    }
