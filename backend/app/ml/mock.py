"""Mock prediction service: demonstration data with the final response shape.

Values are the location's day-of-year averages from the cached climate record, NOT model output.
Every response says so (data_mode="mock" plus a warning), so it can never be mistaken for a forecast.
"""

from __future__ import annotations

from datetime import timedelta

import numpy as np

from app.engine.features import EPOCH
from app.ml.base import ForecastRequest, PredictionService, build_response
from app.services.geo import governorate_for

MOCK_WARNING = "Illustrative mock data. Not a real agricultural forecast."
# Only used to turn the 0-1 wetness index into an illustrative m3/m3 figure for the mock.
_ILLUSTRATIVE_POROSITY = 0.4


class MockPredictionService(PredictionService):
    mode = "mock"

    def predict(self, req: ForecastRequest, climate) -> dict:
        start, end = req.period()
        d = climate.daily
        doy = np.array([(climate.s0 + k + EPOCH) for k in range(d.days)])
        month_day = {}
        from datetime import date

        for k, ordinal in enumerate(doy.tolist()):
            dt = date.fromordinal(ordinal)
            month_day.setdefault((dt.month, dt.day), []).append(k)

        def normal(series: np.ndarray, day) -> float | None:
            idx = month_day.get((day.month, day.day)) or month_day.get((day.month, 28), [])
            v = series[idx]
            v = v[~np.isnan(v)]
            return float(v.mean()) if v.size else None

        days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
        rows = []
        for day in days:
            sm = normal(d.gwt, day)
            rows.append({
                "date": day.isoformat(),
                "temperature_c": _r(normal(d.t, day), 1),
                "relative_humidity_percent": _r(normal(d.rh, day), 1),
                "soil_moisture_m3_m3": _r(None if sm is None else sm * _ILLUSTRATIVE_POROSITY, 3),
                "precipitation_mm": _r(normal(d.pr, day), 1),
                "rain_probability": None,
            })
        mean = lambda key: _r(_avg([r[key] for r in rows]), 1 if key != "soil_moisture_m3_m3" else 3)  # noqa: E731
        summary = {
            "average_temperature_c": mean("temperature_c"),
            "average_relative_humidity_percent": mean("relative_humidity_percent"),
            "average_soil_moisture_m3_m3": mean("soil_moisture_m3_m3"),
            "total_precipitation_mm": _r(sum(r["precipitation_mm"] or 0 for r in rows), 1),
        }
        return build_response(
            req,
            data_mode="mock",
            location={
                "requested_latitude": req.lat, "requested_longitude": req.lon,
                "grid_id": None, "grid_latitude": None, "grid_longitude": None, "mapping_distance_km": None,
                "governorate": governorate_for(req.lat, req.lon),
            },
            daily=rows if req.is_daily else [],
            summary=summary,
            model_version=None,
            data_quality={"latest_observation_date": d.last_date, "is_stale": None, "missing_features": [], "imputed_features": [], "warnings": []},
            warnings=[MOCK_WARNING],
        )

    def status(self) -> dict:
        return {"ai_mode": "mock", "ready": True, "models": [], "message": MOCK_WARNING}


def _r(x, digits):
    return None if x is None else round(x, digits)


def _avg(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None
