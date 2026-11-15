"""Forecasts from the AI prediction service (mock or real, chosen by AI_MODE). Saved per user."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, col, select

from app.api.deps import current_user, owned_farm
from app.api.schemas import ForecastIn
from app.core.db import get_session
from app.core.errors import AppError
from app.engine.decision import crop_outlook
from app.ml.base import ForecastRequest
from app.ml.service import get_prediction_service
from app.models import Forecast, User
from app.services.climate import get_climate
from app.services.geo import require_in_jordan

router = APIRouter(prefix="/forecasts", tags=["forecasts"])


@router.post("", status_code=201)
def create_forecast(body: ForecastIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    require_in_jordan(body.lat, body.lon)
    if body.farm_id:
        owned_farm(session, user, body.farm_id)
    service = get_prediction_service()
    req = ForecastRequest(
        lat=body.lat, lon=body.lon, forecast_type=body.forecast_type,
        horizon_days=body.forecast_horizon_days if body.forecast_type == "rolling" else None,
        season=body.season, season_year=body.season_year, forecast_origin=date.today(),
    )
    req.period()  # validate before touching any data source
    if service.mode == "off":
        service.predict(req, None)  # raises the explicit "disabled" error
    response = service.predict(req, get_climate(session, body.lat, body.lon))
    response["crop_outlook"] = crop_outlook(response)
    row = Forecast(user_id=user.id, farm_id=body.farm_id, request=body.model_dump(), response=response, data_mode=response["data_mode"])
    session.add(row)
    session.commit()
    return {"forecast_id": row.id, **response}


@router.get("/history")
def forecast_history(farm_id: str | None = Query(default=None), user: User = Depends(current_user), session: Session = Depends(get_session)):
    q = select(Forecast).where(Forecast.user_id == user.id)
    if farm_id:
        q = q.where(Forecast.farm_id == farm_id)
    rows = session.exec(q.order_by(col(Forecast.created_at).desc()).limit(100)).all()
    return [
        {"forecast_id": r.id, "farm_id": r.farm_id, "created_at": r.created_at, "data_mode": r.data_mode, "forecast": r.response.get("forecast"), "summary": r.response.get("summary")}
        for r in rows
    ]


@router.get("/{forecast_id}")
def get_forecast(forecast_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    r = session.get(Forecast, forecast_id)
    if not r or r.user_id != user.id:
        raise AppError(404, "NOT_FOUND", "Forecast not found")
    return {"forecast_id": r.id, **r.response}
