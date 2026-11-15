"""Forecast outlook: the AI team's forecasts (30 and 90 days) and their rule-based crop ranking.

The forecasting models, the baseline formulas, the crop table and the scoring rules all live in
`backend/nasa_final/` exactly as the AI team delivered them. This module only adapts them to the
rest of the API: Jordan boundary check, rate limit, the common error format, soil pH from the
team's static soil table, and English text next to the Arabic text the rules produce.

MVP data mode is `historical_demo`: forecasts are computed from a prepared snapshot of features
whose origin date is fixed (see `forecast_origin` in the response). It is not a live forecast.
Nothing is stored.
"""

import csv
import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.ratelimit import limit
from app.services.geo import governorate_for, require_in_jordan

log = logging.getLogger("ardna.outlook")
router = APIRouter(prefix="/outlook", tags=["outlook"])
_s = get_settings()

PACKAGE = Path(__file__).resolve().parents[2] / "nasa_final"
SOIL_CSV = PACKAGE / "data" / "processed" / "Jordan_Soil_Properties_Mean.csv"
REGISTRY = PACKAGE / "AI" / "forecasting" / "Model_Registry.json"

# forecast key in the AI package -> (variable, aggregate, unit)
VARIABLES = {
    "temperature_c": ("T2M", "mean", "°C"),
    "humidity_pct": ("RH2M", "mean", "%"),
    "soil_moisture_m3_m3": ("SFMC", "mean", "m3/m3"),
    "rainfall_mm": ("IMERG_PRECTOT", "sum", "mm"),
}

# English for the Arabic text produced by nasa_final/AI/recommendation_system.py and
# crop_requirements.json. Unknown text is passed through unchanged in both languages.
EN = {
    "متوسط الحرارة ضمن النطاق المقترح للمحصول": "Mean temperature is within the range suggested for the crop",
    "متوسط الحرارة خارج النطاق المقترح للمحصول": "Mean temperature is outside the range suggested for the crop",
    "مؤشر رطوبة سطح التربة بعيد عن نطاق الفحص الأولي": "Surface soil moisture is far from the screening range",
    "الرطوبة الجوية خارج نطاق الفحص الأولي": "Air humidity is outside the screening range",
    "الأمطار المتوقعة قليلة نسبيًا؛ تحقق من توفر الماء": "Expected rainfall is relatively low; check that water is available",
    "توفر الري غير معروف": "Irrigation availability is unknown",
    "حموضة التربة غير متاحة": "Soil pH is not available",
    "حموضة التربة خارج النطاق التقريبي": "Soil pH is outside the approximate range",
    "قد يتأخر الحصاد عن الفترة المحددة حسب الصنف والظروف": "Harvest may come later than the period, depending on variety and conditions",
    "تحقق من خطر الصقيع قبل الزراعة": "Check the frost risk before planting",
    "درجة الملاءمة مؤشر قواعد وليست احتمال نجاح أو ضمان حصاد": "The score is a rule-based index, not a probability of success or a guarantee of harvest",
    "توقع الأمطار ضعيف الدقة؛ لا تستخدمه لتحديد كمية الري": "The rainfall forecast has low accuracy; do not use it to decide irrigation amounts",
    "متوسط الفترة لا يكشف الصقيع أو موجات الحر؛ تحقق من الطقس الفعلي": "A period mean does not reveal frost or heat waves; check the actual weather",
    "قواعد تجريبية غير معايرة محليًا؛ رطوبة السطح ليست رطوبة منطقة الجذور": "Experimental rules, not calibrated locally; surface moisture is not root-zone moisture",
    "صنف سريع النضج": "Fast-maturing variety",
    "حصاد أوراق صغيرة؛ قد يتجاوز الشهر": "Baby-leaf harvest; may take more than a month",
    "حصاد مبكر للأوراق؛ قد يتجاوز الشهر": "Early leaf harvest; may take more than a month",
    "يحتاج تربة عميقة جيدة الصرف": "Needs deep, well-drained soil",
    "يحتاج رطوبة منتظمة وصرفًا جيدًا": "Needs regular moisture and good drainage",
    "محصول دافئ حساس للصقيع": "Warm-season crop, sensitive to frost",
}


def _both(text: str) -> dict:
    return {"ar": text, "en": EN.get(text, text)}


class OutlookIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    irrigation_available: Optional[bool] = None
    # Measured value for the parcel, if the user has one. Otherwise the static soil table is used.
    soil_ph: Optional[float] = Field(default=None, ge=0, le=14)


def _package():
    """The AI team's modules, imported on first use so the API still starts without them."""
    try:
        from nasa_final.AI import recommendation_api as api

        return api
    except Exception as e:  # missing files or missing libraries (pandas, pyarrow, xgboost)
        log.warning("Forecast package unavailable: %s", e)
        raise AppError(503, "MODEL_UNAVAILABLE", "The forecast package is not installed or its libraries are missing.") from e


@lru_cache(maxsize=1)
def _registry() -> dict:
    return json.loads(REGISTRY.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _soil_ph_by_grid() -> dict:
    """Topsoil pH (0-30 cm, depth-weighted) per grid, from the team's static soil table."""
    out = {}
    if not SOIL_CSV.exists():
        return out
    with SOIL_CSV.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            try:
                a, b, c = (float(row[k]) for k in ("Soil_pH_0_5cm_mean", "Soil_pH_5_15cm_mean", "Soil_pH_15_30cm_mean"))
            except (KeyError, ValueError):
                continue
            out[row["GRID_ID"]] = round((a * 5 + b * 10 + c * 15) / 30, 2)
    return out


@router.get("/status")
def outlook_status():
    """Whether the forecast package can be used, and what it covers."""
    try:
        api = _package()
        d, _ = api.load_demo()
        origin = str(d["DATE"].iloc[0].date())
        available = True
    except AppError:
        api, origin, available = None, None, False
    except Exception as e:
        log.warning("Forecast demo data unavailable: %s", e)
        api, origin, available = None, None, False
    return {
        "available": available,
        "data_mode": "historical_demo",
        "forecast_origin": origin,
        "horizons_days": [30, 90],
        "rule_version": api.CATALOG["version"] if api else None,
        "crops": [
            {"crop_id": c["id"], "name": {"ar": c["name_ar"], "en": c["name_en"]}, "horizon_days": c["horizon"], "days_to_harvest": c["days"]}
            for c in (api.CATALOG["crops"] if api else [])
        ],
    }


@router.post("", dependencies=[Depends(limit("guest", _s.rate_limit_guest))])
def outlook(body: OutlookIn):
    """Forecast for the next 30 and 90 days at a location in Jordan, with three ranked crops per period."""
    require_in_jordan(body.lat, body.lon)
    api = _package()
    try:
        d, _ = api.load_demo()
        row, _dist = api.nearest(d, body.lat, body.lon)
        grid_id = str(row.GRID_ID.iloc[0])
    except Exception as e:
        log.warning("Forecast demo data unavailable: %s", e)
        raise AppError(503, "MODEL_UNAVAILABLE", "The forecast data is missing or cannot be read.") from e

    ph, ph_source = body.soil_ph, "user" if body.soil_ph is not None else None
    if ph is None and grid_id in _soil_ph_by_grid():
        ph, ph_source = _soil_ph_by_grid()[grid_id], "soilgrids"

    try:
        raw = api.demo(api.DemoRequest(latitude=body.lat, longitude=body.lon, irrigation_available=body.irrigation_available, soil_ph=ph))
    except HTTPException as e:
        if e.status_code == 422:
            raise AppError(422, "UNSUPPORTED_LOCATION", "This location is too far from the grid points the forecast covers.", {"lat": body.lat, "lon": body.lon}) from e
        raise AppError(503, "MODEL_UNAVAILABLE", "The forecast package is unavailable or incompatible.") from e

    registry = _registry()
    periods, warnings = [], []
    for days in (30, 90):
        p = raw["periods"][str(days)]
        forecast = []
        for key, (variable, agg, unit) in VARIABLES.items():
            entry = registry[f"{variable}_target_{agg}_{days}d"]
            forecast.append(
                {
                    "key": key,
                    "variable": variable,
                    "value": p["forecast"][key],
                    "unit": unit,
                    "method": entry["method"],  # baseline | direct_xgb | residual_xgb
                    "baseline": entry.get("baseline"),
                    "validation_mae": entry.get("validation_mae"),
                }
            )
        periods.append(
            {
                "horizon_days": days,
                "period_start": p["period_start"],
                "period_end": p["period_end"],
                "forecast": forecast,
                "best_candidate": p["best_candidate"],
                "recommendations": [
                    {
                        "crop_id": r["crop_id"],
                        "name": {"ar": r["name_ar"], "en": r["name_en"]},
                        "score": r["score"],
                        "status": r["status"],  # suitable_candidate | conditional | not_recommended
                        "days_to_harvest": r["days_to_harvest"],
                        "note": _both(r["note_ar"]),
                        "reasons": [_both(x) for x in r["reasons"]],
                        "risks": [_both(x) for x in r["risks"]],
                        "factor_scores": r["factor_scores"],
                    }
                    for r in p["recommendations"]
                ],
            }
        )
        for w in p["warnings"]:
            if w not in warnings:
                warnings.append(w)

    return {
        "data_mode": raw["data_mode"],
        "forecast_origin": raw["forecast_origin"],
        "saved": False,
        "location": {"lat": body.lat, "lon": body.lon, "governorate": governorate_for(body.lat, body.lon)},
        "grid": {"id": raw["grid_id"], "lat": raw["matched_latitude"], "lon": raw["matched_longitude"], "distance_km": raw["distance_km"]},
        "irrigation_available": body.irrigation_available,
        "soil_ph": {"value": ph, "source": ph_source} if ph is not None else None,
        "rule_version": api.CATALOG["version"],
        "periods": periods,
        "warnings": [_both(w) for w in warnings],
    }
