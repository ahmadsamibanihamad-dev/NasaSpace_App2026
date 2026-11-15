"""Forecast outlook: the AI team's forecasts (30 and 90 days) and their multi-factor crop ranking.

The forecasting models, the baseline formulas, the crop table, the scoring rules and the
environmental data service all live in `backend/nasa_final/`. This module adapts them to the rest
of the API: Jordan boundary check, rate limit, the common error format, calendar years of the
user's crop history, and English text next to the Arabic text of fixed notes and warnings.

The forecast is made for a planting start date. The default date is the team's prepared demo
snapshot (`historical_demo`). Any other date inside the team's dataset is served by building the
model inputs with the team's own feature code (`app/services/outlook_features.py`), mode
`historical_data`. Neither is a live forecast: the dataset ends on a fixed day. Nothing is stored.

Soil and terrain are looked up for the location, never typed by the user, except optional
laboratory results, which replace the estimate and keep their source. Where the dataset has no
value the factor is reported as unknown.
"""

import json
import logging
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.api.schemas import SoilLab as SoilLabIn  # the same laboratory-results schema a parcel stores
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.ratelimit import limit
from app.services import outlook_features
from app.services.geo import governorate_for, require_in_jordan

log = logging.getLogger("ardna.outlook")
router = APIRouter(prefix="/outlook", tags=["outlook"])
_s = get_settings()

PACKAGE = Path(__file__).resolve().parents[2] / "nasa_final"
FORECAST_DIR = PACKAGE / "AI" / "forecasting"
REGISTRY = FORECAST_DIR / "Model_Registry.json"

# forecast key in the AI package -> (variable, aggregate, unit)
VARIABLES = {
    "temperature_c": ("T2M", "mean", "°C"),
    "humidity_pct": ("RH2M", "mean", "%"),
    "soil_moisture_m3_m3": ("SFMC", "mean", "m3/m3"),
    "rainfall_mm": ("IMERG_PRECTOT", "sum", "mm"),
}

# English for fixed Arabic text (crop notes and general warnings). Explanations of a score come
# from the engine in both languages already.
EN = {
    "درجة الملاءمة مؤشر قواعد وليست احتمال نجاح أو ضمان حصاد": "The score is a rule-based index, not a probability of success or a guarantee of harvest",
    "توقع الأمطار ضعيف الدقة؛ لا تستخدمه لتحديد كمية الري": "The rainfall forecast has low accuracy; do not use it to decide irrigation amounts",
    "متوسط الفترة لا يكشف الصقيع أو موجات الحر؛ تحقق من الطقس الفعلي": "A period mean does not reveal frost or heat waves; check the actual weather",
    "قواعد تجريبية غير معايرة محليًا؛ رطوبة السطح ليست رطوبة منطقة الجذور": "Experimental rules, not calibrated locally; surface moisture is not root-zone moisture",
    "نيتروجين التربة هنا نيتروجين كلي من SoilGrids وليس المتاح للنبات؛ لا تُحدَّد منه كميات السماد": "Soil nitrogen here is total nitrogen from SoilGrids, not plant-available nitrogen; fertilizer amounts are not derived from it",
    "التوقعات تصف الجو الخارجي لا داخل البيت المحمي؛ عوامل الطقس لم تدخل في الدرجة والتوصيات مشروطة": "Forecasts describe outdoor air, not the inside of the greenhouse; the weather factors were left out of the score and the recommendations are conditional",
    "صنف سريع النضج": "Fast-maturing variety",
    "حصاد أوراق صغيرة؛ قد يتجاوز الشهر": "Baby-leaf harvest; may take more than a month",
    "حصاد مبكر للأوراق؛ قد يتجاوز الشهر": "Early leaf harvest; may take more than a month",
    "يحتاج تربة عميقة جيدة الصرف": "Needs deep, well-drained soil",
    "يحتاج رطوبة منتظمة وصرفًا جيدًا": "Needs regular moisture and good drainage",
    "محصول دافئ حساس للصقيع": "Warm-season crop, sensitive to frost",
}


def _both(text: str) -> dict:
    return {"ar": text, "en": EN.get(text, text)}


class HistoryIn(BaseModel):
    year: int = Field(ge=1990, le=2100)
    crop_id: str



class FarmHistoryIn(BaseModel):
    """What the user knows about the land: irrigation and what was grown before."""

    irrigation_available: Optional[bool] = None
    cultivation_type: Optional[Literal["open_field", "greenhouse"]] = None
    previous_crop: Optional[str] = None  # None = unknown
    previous_crop_year: Optional[int] = Field(default=None, ge=1990, le=2100)
    crop_history: list[HistoryIn] = Field(default_factory=list, max_length=10)
    soil_lab: Optional[SoilLabIn] = None


class OutlookIn(FarmHistoryIn):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    # First day of the period to plan for. Omitted = the default (demo) date.
    planting_date: Optional[date] = None
    # Omitted = both horizons.
    horizon_days: Optional[Literal[30, 90]] = None


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


@lru_cache(maxsize=512)
def _site(grid_id: str, start: Optional[date], days: Optional[int], lab: tuple) -> dict:
    """Soil, terrain and historical observations for a grid (cached: the history read takes a moment)."""
    from nasa_final.AI import environment_service as env

    return env.site_context(grid_id, start, days, dict(lab))


def _lab(body: FarmHistoryIn) -> tuple:
    return tuple(sorted((body.soil_lab.model_dump(exclude_none=True) if body.soil_lab else {}).items()))


def soil_summary(site: dict) -> Optional[dict]:
    """Soil of a location for display: topsoil values with the source of each, texture class per rooting depth."""
    soil = site["soil"]
    top = soil["by_depth"]["0-30"]
    props = [{"key": k, "value": round(v["value"], 2), "unit": v["unit"], "source": v["source"]} for k, v in top.items() if v["value"] is not None]
    if not props:
        return None
    return {
        "kind": "static_property",
        "source": "ISRIC SoilGrids",
        "depth_cm": [0, 30],
        "properties": props,
        "texture_class": soil["texture_class"],
        "fertility_percentile": soil["fertility_percentile"],
        "has_laboratory_values": any("laboratory" in (p["source"] or "") for p in props),
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


def previous_crop_list(api) -> list[dict]:
    return [{"crop_id": p["id"], "name": {"ar": p["name_ar"], "en": p["name_en"]}, "family": p["family"]} for p in api.CATALOG["previous_crops"]["items"]]


def history_items(api, body: FarmHistoryIn, planting: date) -> list[dict]:
    """The user's crop history as {"crop_id", "years_ago"}; calendar years are relative to the planting year."""
    known = api.PREVIOUS
    for cid in [body.previous_crop] + [h.crop_id for h in body.crop_history]:
        if cid is not None and cid not in known:
            raise AppError(422, "UNSUPPORTED_CROP", f"Unknown previous crop '{cid}'", {"supported": sorted(known)})
    return api.history_items(planting.year, body.previous_crop, body.previous_crop_year, body.crop_history)


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
        "weights": api.CATALOG["weights"] if api else None,
        "crops": [
            {"crop_id": c["id"], "name": {"ar": c["name_ar"], "en": c["name_en"]}, "family": c["family"], "horizon_days": c["horizon"], "days_to_harvest": c["days"]}
            for c in (api.CATALOG["crops"] if api else [])
        ],
        "previous_crops": previous_crop_list(api) if api else [],
    }


@router.get("/soil")
def soil(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)):
    """Soil and terrain of a location in Jordan, from the team's dataset. Never invented."""
    require_in_jordan(lat, lon)
    row, dist = _nearest_grid(_package(), lat, lon)
    grid_id = str(row.GRID_ID.iloc[0])
    site = _site(grid_id, None, None, ())
    return {
        "grid": {"id": grid_id, "lat": float(row.LATITUDE.iloc[0]), "lon": float(row.LONGITUDE.iloc[0]), "distance_km": round(dist, 2)},
        "soil": soil_summary(site),
        "terrain": site["terrain"],
    }


def forecast_context(lat: float, lon: float, planting_date: Optional[date], lab: tuple = ()) -> dict:
    """The team's 30- and 90-day forecasts for a location and planting date, with grid, soil, terrain and data mode.

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
                        "kind": "forecast",
                        "method": entry["method"],  # baseline | direct_xgb | residual_xgb
                        "baseline": entry.get("baseline"),
                        "validation_mae": entry.get("validation_mae"),
                    }
                )
        sites = {days: _site(grid_id, planting, days, lab) for days in (30, 90)}
    except AppError:
        raise
    except (FileNotFoundError, ImportError, KeyError, ValueError) as e:
        log.warning("Forecast failed: %r", e)
        raise AppError(503, "MODEL_UNAVAILABLE", "The forecast package is unavailable or incompatible.") from e
    return {
        "api": api,
        "mode": mode,
        "planting": planting,
        "origin": origin,
        "dates": dates,
        "values": values,
        "meta": meta,
        "sites": sites,
        "grid_id": grid_id,
        "lab": lab,
        "soil": soil_summary(sites[30]),
        "terrain": sites[30]["terrain"],
        "location": {"lat": lat, "lon": lon, "governorate": governorate_for(lat, lon)},
        "grid": {"id": grid_id, "lat": float(demo_row.LATITUDE.iloc[0]), "lon": float(demo_row.LONGITUDE.iloc[0]), "distance_km": round(dist, 2)},
    }


def recommendation_out(r: dict) -> dict:
    """One ranked crop, ready for the frontend."""
    return {
        "crop_id": r["crop_id"],
        "name": {"ar": r["name_ar"], "en": r["name_en"]},
        "family": r["family"],
        "score": r["score"],
        "environment_score": r["environment_score"],
        "status": r["status"],  # suitable_candidate | conditional | not_recommended
        "days_to_harvest": r["days_to_harvest"],
        "note": _both(r["note_ar"]),
        "component_scores": r["component_scores"],
        "group_scores": r["group_scores"],  # climate, water, soil, fertility, rotation
        "rotation": r["rotation"],
        "coverage_pct": r["coverage_pct"],
        "missing_factors": r["missing_factors"],
        "critical_failures": [{"component": c["component"], "ar": c["ar"], "en": c["en"]} for c in r["critical_failures"]],
        "explanations": r["explanations"],  # [{component, effect, ar, en}]
        "soil_used": r["soil_used"],
    }


@router.post("", dependencies=[Depends(limit("guest", _s.rate_limit_guest))])
def outlook(body: OutlookIn):
    """Forecast for the 30 and 90 days from a planting date at a location in Jordan, with three ranked crops per period."""
    ctx = forecast_context(body.lat, body.lon, body.planting_date, _lab(body))
    api, planting, origin, dates = ctx["api"], ctx["planting"], ctx["origin"], ctx["dates"]
    history = history_items(api, body, planting)
    try:
        periods, warnings, previous = [], [], []
        for days in (body.horizon_days,) if body.horizon_days else (30, 90):
            site = ctx["sites"][days]
            result = api.recommend(days, **ctx["values"][days], irrigation_available=body.irrigation_available, site=site, crop_history=history, cultivation_type=body.cultivation_type)
            previous = result["previous_crops"]
            periods.append(
                {
                    "horizon_days": days,
                    "period_start": str(planting),
                    "period_end": str(origin + timedelta(days=days)),
                    "forecast": ctx["meta"][days],
                    # Observed in the same calendar window of earlier years. Not a forecast.
                    "historical_indicators": site["history"],
                    "status": result["status"],  # ok | no_suitable_recommendation
                    "best_candidate": result["best_candidate"],
                    "recommendations": [recommendation_out(r) for r in result["recommendations"]],
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

    names = api.PREVIOUS
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
        "cultivation_type": body.cultivation_type or "open_field",
        "previous_crops": [{**p, "name": {"ar": names[p["crop_id"]]["name_ar"], "en": names[p["crop_id"]]["name_en"]}} for p in previous],
        "soil": ctx["soil"],
        "terrain": ctx["terrain"],
        "rule_version": api.CATALOG["version"],
        "weights": api.CATALOG["weights"],
        "weight_policy": {
            "ar": "العامل الذي لا تتوفر بياناته يُعدّ غير معروف: يُستبعد ويُوزَّع وزنه على العوامل المعروفة. نسبة التغطية هي حصة الأوزان التي قُيِّمت فعلاً.",
            "en": "A factor with no data is unknown: it is left out and its weight is spread over the known factors. Coverage is the share of the total weight that was actually evaluated.",
        },
        "periods": periods,
        "warnings": [_both(w) for w in warnings],
    }
