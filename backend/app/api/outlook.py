"""Forecast outlook: the AI team's forecasts (30 and 90 days) and their rule-based crop ranking.

The forecasting models, the baseline formulas, the crop table and the scoring rules all live in
`backend/nasa_final/` exactly as the AI team delivered them. This module only adapts them to the
rest of the API: Jordan boundary check, rate limit, the common error format, soil values from the
team's static soil table, and English text next to the Arabic text the rules produce.

The forecast is made for a planting start date. The default date is the team's prepared demo
snapshot (`historical_demo`). Any other date inside the team's dataset is served by building the
model inputs with the team's own feature code (`app/services/outlook_features.py`), mode
`historical_data`. Neither is a live forecast: the dataset ends on a fixed day. Nothing is stored.

Soil information is never typed by the user: it is read from the team's static soil table
(ISRIC SoilGrids values per grid point) and left out where the table has no value.
"""

import csv
import json
import logging
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.ratelimit import limit
from app.services import outlook_features
from app.services.geo import governorate_for, require_in_jordan

log = logging.getLogger("ardna.outlook")
router = APIRouter(prefix="/outlook", tags=["outlook"])
_s = get_settings()

PACKAGE = Path(__file__).resolve().parents[2] / "nasa_final"
SOIL_CSV = PACKAGE / "data" / "processed" / "Jordan_Soil_Properties_Mean.csv"
FORECAST_DIR = PACKAGE / "AI" / "forecasting"
REGISTRY = FORECAST_DIR / "Model_Registry.json"

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

# Soil table columns: (prefix in the CSV, key in the API, unit). Units are those of the team's
# SoilGrids notebook after applying the SoilGrids conversion factors.
SOIL_PROPS = [
    ("Soil_pH", "ph", "pH"),
    ("Sand", "sand", "%"),
    ("Silt", "silt", "%"),
    ("Clay", "clay", "%"),
    ("Organic_Carbon", "organic_carbon", "g/kg"),
    ("Total_Nitrogen", "nitrogen", "g/kg"),
    ("Bulk_Density", "bulk_density", "kg/dm3"),
    ("CEC", "cec", "cmol/kg"),
    ("Coarse_Fragments", "coarse_fragments", "%"),
]
TOPSOIL = [("0_5cm", 5), ("5_15cm", 10), ("15_30cm", 15)]  # layer, thickness in cm


def _both(text: str) -> dict:
    return {"ar": text, "en": EN.get(text, text)}


class OutlookIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    irrigation_available: Optional[bool] = None
    # First day of the period to plan for. Omitted = the default (demo) date.
    planting_date: Optional[date] = None


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
def _soil_table() -> dict:
    """Topsoil (0-30 cm, thickness-weighted mean of the three layers) per grid point."""
    out = {}
    if not SOIL_CSV.exists():
        return out
    with SOIL_CSV.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            props = {}
            for prefix, key, _unit in SOIL_PROPS:
                try:
                    props[key] = round(sum(float(row[f"{prefix}_{layer}_mean"]) * cm for layer, cm in TOPSOIL) / 30, 2)
                except (KeyError, ValueError):
                    continue  # no value in the table for this point: leave it out
            out[row["GRID_ID"]] = props
    return out


def _soil(grid_id: str) -> Optional[dict]:
    props = _soil_table().get(grid_id)
    if not props:
        return None
    return {
        "source": "ISRIC SoilGrids",
        "depth_cm": [0, 30],
        "properties": [{"key": key, "value": props[key], "unit": unit} for _p, key, unit in SOIL_PROPS if key in props],
    }


def _nearest_grid(api, lat: float, lon: float):
    """The grid point of the team's dataset nearest to a location (same rule as their demo: 15 km)."""
    try:
        d, _unused = api.load_demo()
        row, dist = api.nearest(d, lat, lon)
    except Exception as e:
        log.warning("Forecast demo data unavailable: %s", e)
        raise AppError(503, "MODEL_UNAVAILABLE", "The forecast data is missing or cannot be read.") from e
    if dist > 15:
        raise AppError(422, "UNSUPPORTED_LOCATION", "This location is too far from the grid points the data covers.", {"lat": lat, "lon": lon})
    return row, dist


def _dates(api) -> dict:
    """Default planting date and the range of planting dates that can be served."""
    d, _unused = api.load_demo()
    demo_origin = d["DATE"].iloc[0].date()
    default = demo_origin + timedelta(days=1)
    cov = outlook_features.coverage()
    lo, hi = (cov[0] + timedelta(days=1), cov[1] + timedelta(days=1)) if cov else (default, default)
    return {"demo_origin": demo_origin, "default": default, "min": lo, "max": hi}


@router.get("/status")
def outlook_status():
    """Whether the forecast package can be used, and what it covers."""
    try:
        api = _package()
        dates = _dates(api)
        available = True
    except AppError:
        api, dates, available = None, None, False
    except Exception as e:
        log.warning("Forecast demo data unavailable: %s", e)
        api, dates, available = None, None, False
    return {
        "available": available,
        "forecast_origin": str(dates["demo_origin"]) if dates else None,
        "default_planting_date": str(dates["default"]) if dates else None,
        "planting_date_min": str(dates["min"]) if dates else None,
        "planting_date_max": str(dates["max"]) if dates else None,
        "horizons_days": [30, 90],
        "rule_version": api.CATALOG["version"] if api else None,
        "crops": [
            {"crop_id": c["id"], "name": {"ar": c["name_ar"], "en": c["name_en"]}, "horizon_days": c["horizon"], "days_to_harvest": c["days"]}
            for c in (api.CATALOG["crops"] if api else [])
        ],
    }


@router.get("/soil")
def soil(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)):
    """Soil properties for a location in Jordan, from the team's static soil table. Never invented."""
    require_in_jordan(lat, lon)
    row, dist = _nearest_grid(_package(), lat, lon)
    grid_id = str(row.GRID_ID.iloc[0])
    return {
        "grid": {"id": grid_id, "lat": float(row.LATITUDE.iloc[0]), "lon": float(row.LONGITUDE.iloc[0]), "distance_km": round(dist, 2)},
        "soil": _soil(grid_id),
    }


def forecast_context(lat: float, lon: float, planting_date: Optional[date]) -> dict:
    """The team's 30- and 90-day forecasts for a location and planting date, with grid, soil and data mode.

    Shared by the outlook and by the crop rotation planner so that both use the same location,
    the same forecast origin and the same cached models.
    """
    require_in_jordan(lat, lon)
    api = _package()
    demo_row, dist = _nearest_grid(api, lat, lon)
    grid_id = str(demo_row.GRID_ID.iloc[0])
    dates = _dates(api)
    planting = planting_date or dates["default"]
    if not (dates["min"] <= planting <= dates["max"]):
        raise AppError(
            422,
            "DATE_OUT_OF_RANGE",
            "The planting date is outside the period the data covers.",
            {"min": str(dates["min"]), "max": str(dates["max"]), "default": str(dates["default"])},
        )
    origin = planting - timedelta(days=1)  # the last day with observations; the period starts the next day
    try:
        if origin == dates["demo_origin"]:
            row, mode = demo_row, "historical_demo"
        else:
            row, mode = outlook_features.features_for(grid_id, origin), "historical_data"
        from nasa_final.AI.forecasting.mvp_inference import predict_entry

        registry = _registry()
        values, meta = {}, {}
        for days in (30, 90):
            values[days], meta[days] = {}, []
            for key, (variable, agg, unit) in VARIABLES.items():
                target = f"{variable}_target_{agg}_{days}d"
                entry = registry[target]
                values[days][key] = float(predict_entry(row, target, entry, FORECAST_DIR)[0])
                meta[days].append(
                    {
                        "key": key,
                        "variable": variable,
                        "value": values[days][key],
                        "unit": unit,
                        "method": entry["method"],  # baseline | direct_xgb | residual_xgb
                        "baseline": entry.get("baseline"),
                        "validation_mae": entry.get("validation_mae"),
                    }
                )
    except AppError:
        raise
    except (FileNotFoundError, ImportError, KeyError, ValueError) as e:
        log.warning("Forecast failed: %r", e)
        raise AppError(503, "MODEL_UNAVAILABLE", "The forecast package is unavailable or incompatible.") from e
    soil_info = _soil(grid_id)
    return {
        "api": api,
        "mode": mode,
        "planting": planting,
        "origin": origin,
        "dates": dates,
        "values": values,
        "meta": meta,
        "soil": soil_info,
        "soil_ph": next((x["value"] for x in (soil_info or {}).get("properties", []) if x["key"] == "ph"), None),
        "location": {"lat": lat, "lon": lon, "governorate": governorate_for(lat, lon)},
        "grid": {"id": grid_id, "lat": float(demo_row.LATITUDE.iloc[0]), "lon": float(demo_row.LONGITUDE.iloc[0]), "distance_km": round(dist, 2)},
    }


@router.post("", dependencies=[Depends(limit("guest", _s.rate_limit_guest))])
def outlook(body: OutlookIn):
    """Forecast for the 30 and 90 days from a planting date at a location in Jordan, with three ranked crops per period."""
    ctx = forecast_context(body.lat, body.lon, body.planting_date)
    api, planting, origin, dates = ctx["api"], ctx["planting"], ctx["origin"], ctx["dates"]
    try:
        # Same steps as the team's demo endpoint: forecast the four variables, then rank the crops.
        periods, warnings = [], []
        for days in (30, 90):
            values, forecast = ctx["values"][days], ctx["meta"][days]
            result = api.recommend(days, **values, irrigation_available=body.irrigation_available, soil_ph=ctx["soil_ph"])
            periods.append(
                {
                    "horizon_days": days,
                    "period_start": str(planting),
                    "period_end": str(origin + timedelta(days=days)),
                    "forecast": forecast,
                    "best_candidate": result["best_candidate"],
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
                        for r in result["recommendations"]
                    ],
                }
            )
            for w in result["warnings"]:
                if w not in warnings:
                    warnings.append(w)
    except AppError:
        raise
    except (FileNotFoundError, ImportError, KeyError, ValueError) as e:
        log.warning("Forecast failed: %r", e)
        raise AppError(503, "MODEL_UNAVAILABLE", "The forecast package is unavailable or incompatible.") from e

    return {
        "data_mode": ctx["mode"],
        "planting_date": str(planting),
        "forecast_origin": str(origin),
        "is_default_date": planting == dates["default"],
        "planting_date_min": str(dates["min"]),
        "planting_date_max": str(dates["max"]),
        "saved": False,
        "location": ctx["location"],
        "grid": ctx["grid"],
        "irrigation_available": body.irrigation_available,
        "soil": ctx["soil"],
        "rule_version": api.CATALOG["version"],
        "periods": periods,
        "warnings": [_both(w) for w in warnings],
    }
