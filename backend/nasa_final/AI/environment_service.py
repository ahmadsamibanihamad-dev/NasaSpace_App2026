"""Environmental data service: static soil and terrain properties and historical indicators per grid.

Everything here is read from the project's own datasets by GRID_ID. Nothing is predicted and
nothing is filled in: a missing value stays missing and is reported as such.

* Soil (ISRIC SoilGrids, five depths) and terrain (Copernicus DEM: elevation, slope, aspect) are
  STATIC properties. They are read from the feature snapshot, which carries them for all 835 grids.
* Minimum / maximum temperature, root-zone and profile soil moisture, soil wetness, solar
  radiation, wind, dew point and pressure have no trained forecasting model. They are returned as
  HISTORICAL OBSERVATIONS: the mean of the same calendar window in earlier years of the master
  dataset. They are never presented as a forecast. Without the master dataset they are absent.
"""

from bisect import bisect_right
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "data" / "demo" / "Historical_Demo_Features.parquet"
MASTER = ROOT / "data" / "processed" / "master_2019_2026" / "Jordan_Master_Dataset_2019_2026_Cleaned.parquet"

# (column prefix in the dataset, key, unit) - names as they appear in the dataset schema
SOIL_PROPS = [
    ("Soil_pH", "ph", "pH"),
    ("Sand", "sand", "%"),
    ("Silt", "silt", "%"),
    ("Clay", "clay", "%"),
    ("Organic_Carbon", "organic_carbon", "g/kg"),
    ("Total_Nitrogen", "nitrogen", "g/kg"),
    ("CEC", "cec", "cmol/kg"),
    ("Bulk_Density", "bulk_density", "kg/dm3"),
    ("Coarse_Fragments", "coarse_fragments", "%"),
]
LAYERS = [("0_5cm", 0, 5), ("5_15cm", 5, 15), ("15_30cm", 15, 30), ("30_60cm", 30, 60), ("60_100cm", 60, 100)]
DEPTHS = [(0, 30), (0, 60)]  # rooting-depth windows used by the crop table
FERTILITY_KEYS = ("organic_carbon", "nitrogen", "cec")
SOIL_SOURCE = "ISRIC SoilGrids (static, team dataset)"
TERRAIN_SOURCE = "Copernicus DEM 30 m (static, team dataset)"
HISTORY_COLUMNS = ["T2M_MIN", "T2M_MAX", "RZMC", "PRMC", "GWETTOP", "GWETROOT", "GWETPROF", "ALLSKY_SFC_SW_DWN", "WS2M", "T2MDEW", "PS"]


def depth_key(top: int, bottom: int) -> str:
    return f"{top}-{bottom}"


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # NaN -> None


@lru_cache(maxsize=1)
def _static():
    """GRID_ID -> row of static soil and terrain columns."""
    import pandas as pd

    cols = ["GRID_ID", "LATITUDE", "LONGITUDE", "Elevation", "Slope", "Aspect"] + [f"{p}_{layer}_mean" for p, _, _ in SOIL_PROPS for layer, _, _ in LAYERS]
    return pd.read_parquet(DEMO, columns=cols).set_index("GRID_ID")


def soil_layers(grid_id: str) -> list[dict]:
    """The five SoilGrids layers of a grid, with None for values the dataset does not have."""
    row = _static().loc[grid_id]
    out = []
    for layer, top, bottom in LAYERS:
        item = {"top_cm": top, "bottom_cm": bottom}
        for prefix, key, _ in SOIL_PROPS:
            item[key] = _num(row[f"{prefix}_{layer}_mean"])
        out.append(item)
    return out


def depth_weighted(layers: list[dict], key: str, top: int, bottom: int):
    """Thickness-weighted mean of the layers inside [top, bottom] cm. None when no layer has a value."""
    total = weight = 0.0
    for layer in layers:
        overlap = min(bottom, layer["bottom_cm"]) - max(top, layer["top_cm"])
        v = layer.get(key)
        if overlap > 0 and v is not None:
            total += v * overlap
            weight += overlap
    return round(total / weight, 3) if weight else None


def texture_class(sand, silt, clay):
    """USDA soil texture class from sand / silt / clay percentages. None when a fraction is missing."""
    if sand is None or silt is None or clay is None:
        return None
    s = sand + silt + clay
    if s <= 0:
        return None
    sand, silt, clay = 100 * sand / s, 100 * silt / s, 100 * clay / s
    if silt + 1.5 * clay < 15:
        return "sand"
    if silt + 2 * clay < 30:
        return "loamy sand"
    if (7 <= clay < 20 and sand > 52) or (clay < 7 and silt < 50):
        return "sandy loam"
    if 7 <= clay < 27 and 28 <= silt < 50 and sand <= 52:
        return "loam"
    if (silt >= 50 and 12 <= clay < 27) or (50 <= silt < 80 and clay < 12):
        return "silt loam"
    if silt >= 80 and clay < 12:
        return "silt"
    if 20 <= clay < 35 and silt < 28 and sand > 45:
        return "sandy clay loam"
    if 27 <= clay < 40 and 20 < sand <= 45:
        return "clay loam"
    if 27 <= clay < 40 and sand <= 20:
        return "silty clay loam"
    if clay >= 35 and sand > 45:
        return "sandy clay"
    if clay >= 40 and silt >= 40:
        return "silty clay"
    if clay >= 40:
        return "clay"
    return "loam"


@lru_cache(maxsize=4)
def _fertility_distribution(top: int, bottom: int) -> dict:
    """Sorted depth-weighted values of the fertility indicators over all grids of Jordan."""
    import numpy as np

    frame = _static()
    prefix = {key: p for p, key, _ in SOIL_PROPS}
    out = {}
    for k in FERTILITY_KEYS:
        total = np.zeros(len(frame))
        weight = np.zeros(len(frame))
        for layer, lt, lb in LAYERS:
            overlap = min(bottom, lb) - max(top, lt)
            if overlap <= 0:
                continue
            v = frame[f"{prefix[k]}_{layer}_mean"].to_numpy(dtype="float64")
            ok = ~np.isnan(v)
            total[ok] += v[ok] * overlap
            weight[ok] += overlap
        values = np.round(total[weight > 0] / weight[weight > 0], 3)
        out[k] = sorted(values.tolist())
    return out


def percentile(key: str, value, top: int, bottom: int):
    """Share (0-100) of Jordan's grid points whose value is at or below `value`. A relative position, not a sufficiency level."""
    dist = _fertility_distribution(top, bottom)[key]
    if value is None or not dist:
        return None
    return round(100.0 * bisect_right(dist, value) / len(dist), 1)


def terrain(grid_id: str) -> dict:
    import math

    row = _static().loc[grid_id]
    slope = _num(row["Slope"])
    aspect = _num(row["Aspect"])
    return {
        "elevation_m": _num(row["Elevation"]),
        "slope_deg": slope,
        "slope_pct": None if slope is None else round(100 * math.tan(math.radians(slope)), 2),
        "aspect_deg": None if aspect is None or aspect < 0 else aspect,  # -1 in the dataset = flat, no aspect
        "source": TERRAIN_SOURCE,
    }


def master_available() -> bool:
    return MASTER.exists()


@lru_cache(maxsize=32)
def _history_frame(grid_id: str):
    import pandas as pd

    d = pd.read_parquet(MASTER, columns=["DATE"] + HISTORY_COLUMNS, filters=[("GRID_ID", "==", grid_id)])
    d["DATE"] = pd.to_datetime(d["DATE"])
    return d.sort_values("DATE").set_index("DATE")


def historical_window(grid_id: str, start: date, days: int):
    """Observed conditions in the same calendar window of earlier years (complete windows that ended before `start`).

    Returns None when the master dataset is not installed or no earlier year covers the window.
    """
    if not master_available():
        return None
    import pandas as pd

    frame = _history_frame(grid_id)
    if frame.empty:
        return None
    years, rows = [], []
    for year in range(frame.index[0].year, start.year + 1):
        try:
            s = start.replace(year=year)
        except ValueError:  # 29 February in a non-leap year
            s = date(year, 2, 28)
        e = s + timedelta(days=days - 1)
        if e >= start:
            continue  # only windows that were fully observed before the planning window starts
        w = frame.loc[pd.Timestamp(s): pd.Timestamp(e)]
        if len(w) < days:
            continue
        years.append(year)
        rows.append(
            {
                "t2m_min_mean": float(w["T2M_MIN"].mean()),
                "t2m_min_lowest": float(w["T2M_MIN"].min()),
                "frost": bool((w["T2M_MIN"] <= 0).any()),
                "t2m_max_mean": float(w["T2M_MAX"].mean()),
                "t2m_max_highest": float(w["T2M_MAX"].max()),
                "root_zone_moisture_m3_m3": float(w["RZMC"].mean()),
                "profile_moisture_m3_m3": float(w["PRMC"].mean()),
                "surface_wetness": float(w["GWETTOP"].mean()),
                "root_zone_wetness": float(w["GWETROOT"].mean()),
                "profile_wetness": float(w["GWETPROF"].mean()),
                "solar_radiation": float(w["ALLSKY_SFC_SW_DWN"].mean()),
                "wind_speed_m_s": float(w["WS2M"].mean()),
                "dew_point_c": float(w["T2MDEW"].mean()),
                "pressure_kpa": float(w["PS"].mean()),
            }
        )
    if not rows:
        return None
    mean = lambda k: round(sum(r[k] for r in rows) / len(rows), 3)  # noqa: E731
    return {
        "kind": "historical_observation",
        "note": "Mean of the same calendar window in earlier years. Not a forecast.",
        "years": years,
        "window_days": days,
        "t2m_min_mean_c": mean("t2m_min_mean"),
        "t2m_min_lowest_c": round(min(r["t2m_min_lowest"] for r in rows), 2),
        "frost_frequency": round(sum(r["frost"] for r in rows) / len(rows), 3),
        "t2m_max_mean_c": mean("t2m_max_mean"),
        "t2m_max_highest_c": round(max(r["t2m_max_highest"] for r in rows), 2),
        "root_zone_moisture_m3_m3": mean("root_zone_moisture_m3_m3"),
        "profile_moisture_m3_m3": mean("profile_moisture_m3_m3"),
        "surface_wetness": mean("surface_wetness"),
        "root_zone_wetness": mean("root_zone_wetness"),
        "profile_wetness": mean("profile_wetness"),
        "solar_radiation": mean("solar_radiation"),
        "wind_speed_m_s": mean("wind_speed_m_s"),
        "dew_point_c": mean("dew_point_c"),
        "pressure_kpa": mean("pressure_kpa"),
    }


def site_context(grid_id: str, start: date | None = None, days: int | None = None, soil_overrides: dict | None = None) -> dict:
    """Everything the recommendation engine needs about a location besides the four forecasts.

    `soil_overrides` are laboratory results supplied by the user ({"ph": 7.1, "clay": 30, ...}). They
    replace the estimated value for every rooting depth, and the source of each value is kept.
    """
    overrides = {k: float(v) for k, v in (soil_overrides or {}).items() if v is not None}
    layers = soil_layers(grid_id)
    by_depth, textures, ranks = {}, {}, {}
    for top, bottom in DEPTHS:
        dk = depth_key(top, bottom)
        values = {}
        for _, key, unit in SOIL_PROPS:
            if key in overrides:
                values[key] = {"value": overrides[key], "unit": unit, "source": "laboratory result (user)"}
            else:
                v = depth_weighted(layers, key, top, bottom)
                values[key] = {"value": v, "unit": unit, "source": SOIL_SOURCE if v is not None else None}
        by_depth[dk] = values
        cls = texture_class(values["sand"]["value"], values["silt"]["value"], values["clay"]["value"])
        textures[dk] = cls
        ranks[dk] = {k: percentile(k, values[k]["value"], top, bottom) for k in FERTILITY_KEYS}
    return {
        "grid_id": grid_id,
        "soil": {
            "kind": "static_property",
            "layers": layers,
            "by_depth": by_depth,
            "texture_class": textures,
            "fertility_percentile": ranks,
            "fertility_note": "Percentile among Jordan's 835 grid points. A relative position, not a nutrient sufficiency level.",
            "has_data": any(v["value"] is not None for v in by_depth[depth_key(*DEPTHS[0])].values()),
        },
        "terrain": {"kind": "static_property", **terrain(grid_id)},
        "history": historical_window(grid_id, start, days) if start and days else None,
    }
