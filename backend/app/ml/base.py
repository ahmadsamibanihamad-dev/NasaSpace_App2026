"""AI forecasting integration layer: one interface, three implementations.

    AI_MODE=off         DisabledPredictionService   no forecasts (recommendations use the climate record)
    AI_MODE=mock        MockPredictionService       clearly labelled demonstration data, same response shape
    AI_MODE=production  ProductionPredictionService real model artifacts; never falls back to mock

The frontend only ever sees the standard response built by `build_response`, so swapping the
implementation (or the algorithm behind it) needs no frontend change.

Targets the AI team is training models for:
    T2M (temperature), RH2M (relative humidity), SFMC (surface soil moisture), IMERG_PRECTOT (precipitation)
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

from app.core.errors import AppError

SCHEMA_VERSION = "1.0"
TARGETS = ("T2M", "RH2M", "SFMC", "IMERG_PRECTOT")
DAILY_HORIZONS = (7, 30)  # horizons with one prediction per day; 90 days and seasons are aggregates only
SEASON_MONTHS = {"winter": (12, 1, 2), "spring": (3, 4, 5), "summer": (6, 7, 8), "autumn": (9, 10, 11)}


def season_dates(season: str, season_year: int) -> tuple[date, date]:
    """Meteorological season. Winter N is December N-1 to February N (the year containing January)."""
    if season == "winter":
        start = date(season_year - 1, 12, 1)
        end = date(season_year, 3, 1) - timedelta(days=1)
    else:
        first = SEASON_MONTHS[season][0]
        start = date(season_year, first, 1)
        end = date(season_year, first + 3, 1) - timedelta(days=1)
    return start, end


@dataclass
class ForecastRequest:
    lat: float
    lon: float
    forecast_type: str  # "rolling" | "calendar_season"
    horizon_days: Optional[int]  # 7 | 30 | 90 for rolling forecasts
    season: Optional[str]
    season_year: Optional[int]
    forecast_origin: date

    def period(self) -> tuple[date, date]:
        if self.forecast_type == "calendar_season":
            if not self.season or not self.season_year:
                raise AppError(422, "VALIDATION_ERROR", "season and season_year are required for a calendar-season forecast")
            return season_dates(self.season, self.season_year)
        if self.horizon_days not in (7, 30, 90):
            raise AppError(422, "VALIDATION_ERROR", "forecast_horizon_days must be 7, 30 or 90")
        return self.forecast_origin + timedelta(days=1), self.forecast_origin + timedelta(days=self.horizon_days)

    @property
    def is_daily(self) -> bool:
        return self.forecast_type == "rolling" and self.horizon_days in DAILY_HORIZONS


def build_response(
    req: ForecastRequest,
    *,
    data_mode: str,
    location: dict,
    daily: list[dict],
    summary: dict,
    model_version: Optional[str],
    data_quality: dict,
    warnings: list[str],
    confidence: Optional[str] = None,
    prediction_intervals: Optional[dict] = None,
) -> dict:
    """The standard, versioned forecast response. Unavailable values are null, never invented."""
    start, end = req.period()
    return {
        "schema_version": SCHEMA_VERSION,
        "request_id": f"forecast-{uuid.uuid4().hex[:12]}",
        "status": "success",
        "data_mode": data_mode,
        "location": location,
        "forecast": {
            "type": req.forecast_type,
            "horizon_days": req.horizon_days if req.forecast_type == "rolling" else (end - start).days + 1,
            "season": req.season if req.forecast_type == "calendar_season" else None,
            "season_year": req.season_year if req.forecast_type == "calendar_season" else None,
            "forecast_origin": req.forecast_origin.isoformat(),
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "model_version": model_version,
            "confidence": confidence,
        },
        "data_quality": data_quality,
        # daily values exist only for 7- and 30-day forecasts; aggregates are never expanded into fake days
        "daily_predictions": daily,
        "summary": summary,
        "prediction_intervals": prediction_intervals,
        "warnings": warnings,
    }


class PredictionService(ABC):
    mode: str = "off"

    @abstractmethod
    def predict(self, req: ForecastRequest, climate) -> dict:
        """Return the standard forecast response, or raise AppError with an explicit unavailable status."""

    @abstractmethod
    def status(self) -> dict:
        """Deployment status of the models (for GET /models/status)."""


class DisabledPredictionService(PredictionService):
    mode = "off"

    def predict(self, req: ForecastRequest, climate) -> dict:
        raise AppError(503, "FORECAST_DISABLED", "Forecasting models are not enabled on this server (AI_MODE=off)")

    def status(self) -> dict:
        return {"ai_mode": "off", "ready": False, "models": [], "message": "Forecasting is disabled; recommendations use the historical climate record."}
