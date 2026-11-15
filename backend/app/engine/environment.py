"""Environment summary and time series for the dashboard / analytics pages.

Port of frontend/src/lib/climate/environment.ts.
"""

from __future__ import annotations

from datetime import date
from typing import Callable, Optional

import numpy as np

from app.engine.features import EPOCH, Climate, MonthlyRow, _mean, from_day, monthly_climatology, monthly_series, to_day

POWER_SOURCE = "NASA POWER"
STALE_AFTER_DAYS = 14


def data_meta(c: Climate, basis: str, is_demo: bool = False) -> dict:
    """Provenance attached to every result: sources actually used, quality, confidence and freshness."""
    days_old = (date.today().toordinal() - EPOCH) - to_day(c.daily.last_date)
    return {
        "data_sources": [POWER_SOURCE],
        # soil moisture and rainfall come from POWER, not SMAP / IMERG, so quality is reported as limited
        "data_quality": "poor" if c.completeness < 0.8 or c.record_years < 5 else "limited",
        "confidence": "medium" if c.record_years >= 10 and c.completeness >= 0.95 else "low",
        "data_timestamp": c.daily.last_date,
        "data_freshness": {"latest_observation_date": c.daily.last_date, "days_old": days_old, "is_stale": days_old > STALE_AFTER_DAYS},
        "analysis_basis": basis,
        "is_demo": is_demo,
        "notes": [],
    }


def _last_n(a: np.ndarray, end: int, n: int) -> Optional[float]:
    v = a[max(0, end - n + 1): end + 1]
    v = v[~np.isnan(v)]
    return float(v.mean()) if v.size else None


def soil_anomaly(c: Climate) -> Optional[float]:
    """Root-zone wetness of the last 30 days minus the long-term mean of the current month."""
    cur = monthly_series(c)[-1]
    recent = _last_n(c.daily.gwr, c.last_idx, 30)
    clim = monthly_climatology(monthly_series(c), lambda r: r.gwr, cur.key)[cur.month - 1]
    return recent - clim if recent is not None and clim is not None else None


def env_summary(c: Climate, lat: float, lon: float) -> dict:
    d = c.daily
    end = c.last_idx
    rows = monthly_series(c)
    recent = rows[-12:]
    cur = rows[-1]
    clim_of = lambda pick: monthly_climatology(rows, pick, cur.key)[cur.month - 1]  # noqa: E731

    # rainy season to date (1 October to the latest day) against the same span in other years
    ly, lm = int(d.last_date[:4]), int(d.last_date[5:7])
    season_year = ly if lm >= 10 else ly - 1
    span = end - (to_day(f"{season_year}-10-01") - c.s0)
    pr = np.nan_to_num(d.pr, nan=0.0)

    def total(y: int) -> Optional[float]:
        a = to_day(f"{y}-10-01") - c.s0
        if a < 0 or a + span > end:
            return None
        return float(pr[a: a + span + 1].sum())

    season_rain = total(season_year)
    others = [x for x in (total(y) for y in range(c.first_year, season_year)) if x is not None]
    hist_rain = _mean(others) if others else None

    sm, sm_hist = _last_n(d.gwr, end, 30), clim_of(lambda r: r.gwr)
    t30, t_hist = _last_n(d.t, end, 30), clim_of(lambda r: r.t)
    last30 = {"ar": "متوسط آخر 30 يوماً", "en": "Mean of the last 30 days"}
    pct = lambda x: None if x is None else x * 100  # noqa: E731

    return {
        **data_meta(c, "recent_observations"),
        "lat": lat,
        "lon": lon,
        "metrics": {
            "soil_moisture": {
                "value": pct(sm), "unit": "%", "source": POWER_SOURCE, "period": last30,
                "trend": [{"label": r.key, "value": pct(r.gwr)} for r in recent],
                "historical_mean": pct(sm_hist),
                "anomaly": (sm - sm_hist) * 100 if sm is not None and sm_hist is not None else None,
            },
            "temperature": {
                "value": t30, "unit": "°C", "source": POWER_SOURCE, "period": last30,
                "trend": [{"label": r.key, "value": r.t} for r in recent],
                "historical_mean": t_hist,
                "anomaly": t30 - t_hist if t30 is not None and t_hist is not None else None,
            },
            "seasonal_rainfall": {
                "value": season_rain, "unit": "mm", "source": POWER_SOURCE,
                "period": {"ar": f"من 1 تشرين الأول {season_year} حتى {d.last_date}", "en": f"1 October {season_year} to {d.last_date}"},
                "trend": [{"label": r.key, "value": r.rain} for r in recent],
                "historical_mean": hist_rain,
                "anomaly": season_rain - hist_rain if season_rain is not None and hist_rain is not None else None,
            },
        },
    }


_VARS: dict[str, dict] = {
    "temperature": {"unit": "°C", "daily": lambda c: c.daily.t, "monthly": lambda r: r.t, "sum": False, "scale": 1},
    "rainfall": {"unit": "mm", "daily": lambda c: c.daily.pr, "monthly": lambda r: r.rain, "sum": True, "scale": 1},
    "soil_moisture": {"unit": "%", "daily": lambda c: c.daily.gwr, "monthly": lambda r: r.gwr, "sum": False, "scale": 100},
    "humidity": {"unit": "%", "daily": lambda c: c.daily.rh, "monthly": lambda r: r.rh, "sum": False, "scale": 1},
    "solar_radiation": {"unit": "MJ/m²", "daily": lambda c: c.daily.rs, "monthly": lambda r: r.rs, "sum": False, "scale": 1},
}
VARIABLES = tuple(_VARS)
RESOLUTIONS = ("daily", "monthly", "seasonal", "annual")
_SEASON_OF = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0]  # month index to DJF, MAM, JJA, SON
_SEASON_KEYS = ["winter", "spring", "summer", "autumn"]


def time_series(c: Climate, variable: str, resolution: str) -> dict:
    var = _VARS[variable]
    pick: Callable[[MonthlyRow], Optional[float]] = var["monthly"]
    scale = var["scale"]
    rows = monthly_series(c)
    sc = lambda x: None if x is None else x * scale  # noqa: E731

    def agg(xs):
        ok = [x for x in xs if x is not None]
        if not ok:
            return None
        return sum(ok) if var["sum"] else _mean(ok)

    points: list[dict] = []
    if resolution == "daily":
        series = var["daily"](c)
        end = c.last_idx
        start = max(0, end - 364)
        # day-of-year climatology from the earlier years (+-3-day window to smooth single-day noise)
        by_md: dict[str, list[float]] = {}
        for k in range(start):
            x = series[k]
            if x != x:
                continue
            by_md.setdefault(from_day(c.s0 + k)[5:], []).append(float(x))
        for k in range(start, end + 1):
            pool: list[float] = []
            for o in range(-3, 4):
                pool.extend(by_md.get(from_day(c.s0 + k + o)[5:], []))
            x = series[k]
            points.append({"t": from_day(c.s0 + k), "value": None if x != x else float(x) * scale, "historical_mean": _mean(pool) * scale if pool else None})
    elif resolution == "monthly":
        clim = monthly_climatology(rows, pick)
        points = [{"t": r.key, "value": sc(pick(r)), "historical_mean": sc(clim[r.month - 1])} for r in rows[-24:]]
    elif resolution == "seasonal":
        groups: dict[str, list[MonthlyRow]] = {}
        for r in rows:
            y = r.year + 1 if r.month == 12 else r.year  # DJF belongs to January's year
            groups.setdefault(f"{y}-{_SEASON_KEYS[_SEASON_OF[r.month - 1]]}", []).append(r)
        full = [(k, g) for k, g in groups.items() if len(g) == 3]
        val = lambda g: agg([pick(r) for r in g])  # noqa: E731
        hist: dict[str, Optional[float]] = {}
        for s in _SEASON_KEYS:
            xs = [x for x in (val(g) for k, g in full if k.endswith(s)) if x is not None]
            hist[s] = _mean(xs) if xs else None
        points = [{"t": k, "value": sc(val(g)), "historical_mean": sc(hist[k.split("-")[1]])} for k, g in full[-12:]]
    else:
        years: dict[int, list[MonthlyRow]] = {}
        for r in rows:
            years.setdefault(r.year, []).append(r)
        full_years = [(y, g) for y, g in years.items() if len(g) == 12 and all(r.days >= 27 for r in g)]
        vals = [(y, agg([pick(r) for r in g])) for y, g in full_years]
        ok = [x for _, x in vals if x is not None]
        h = _mean(ok) if ok else None
        points = [{"t": str(y), "value": sc(x), "historical_mean": sc(h)} for y, x in vals]

    return {**data_meta(c, "recent_observations"), "variable": variable, "unit": var["unit"], "resolution": resolution, "points": points}
