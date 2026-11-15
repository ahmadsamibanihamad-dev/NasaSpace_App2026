"""Daily climate record per location: NASA POWER client with a database cache.

Parameter names were verified against the live POWER API (v2.10.3, community=AG):
  T2M, T2M_MIN, T2M_MAX (C), RH2M (%), WS2M (m/s), ALLSKY_SFC_SW_DWN (MJ/m2/day),
  PRECTOTCORR (mm/day), GWETTOP, GWETROOT (soil wetness, 0-1 fraction).
The record is cached per 0.5-degree cell; the fill value (-999) becomes missing.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np
from sqlmodel import Session, select

from app.core.config import get_settings
from app.core.errors import AppError
from app.engine.features import Climate, Daily, build_climate, from_day, to_day
from app.models import EnvCache, utcnow

log = logging.getLogger("ardna.climate")
POWER_PARAMS = ["T2M", "T2M_MIN", "T2M_MAX", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN", "PRECTOTCORR", "GWETTOP", "GWETROOT"]
SOURCE = "POWER"
_FIELDS = {"T2M": "t", "T2M_MIN": "tmin", "T2M_MAX": "tmax", "RH2M": "rh", "WS2M": "ws", "ALLSKY_SFC_SW_DWN": "rs", "PRECTOTCORR": "pr", "GWETTOP": "gwt", "GWETROOT": "gwr"}

_memory: dict[str, tuple[float, Climate]] = {}
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


def cell_of(lat: float, lon: float) -> tuple[str, float, float]:
    la, lo = round(lat * 2) / 2, round(lon * 2) / 2
    return f"{la:.1f}_{lo:.1f}", la, lo


def parse_power(payload: dict, cell: str, lat: float, lon: float) -> Daily:
    """Turn a raw POWER JSON response into aligned daily arrays."""
    params = (payload.get("properties") or {}).get("parameter") or {}
    if "T2M" not in params or not params["T2M"]:
        raise AppError(502, "MISSING_DATA", "NASA POWER returned no data for this location")
    fill = (payload.get("header") or {}).get("fill_value", -999)
    keys = sorted(params["T2M"])
    iso = lambda k: f"{k[:4]}-{k[4:6]}-{k[6:8]}"  # noqa: E731
    start = iso(keys[0])
    s0 = to_day(start)
    days = to_day(iso(keys[-1])) - s0 + 1
    arrays = {}
    for name, field in _FIELDS.items():
        a = np.full(days, np.nan)
        for k, val in (params.get(name) or {}).items():
            if val is None or val == fill or not math.isfinite(val) or val <= -900:
                continue
            a[to_day(iso(k)) - s0] = round(val, 2)
        arrays[field] = a
    last = days - 1
    while last > 0 and math.isnan(arrays["t"][last]):
        last -= 1
    coords = (payload.get("geometry") or {}).get("coordinates") or []
    return Daily(
        lat=lat, lon=lon, elevation=float(coords[2]) if len(coords) > 2 else 0.0, start=start, last_date=from_day(s0 + last),
        cell=cell, fetched_at=utcnow().isoformat(), **arrays,
    )


def _fetch_power(lat: float, lon: float, cell: str) -> Daily:
    s = get_settings()
    now = datetime.now(timezone.utc)
    start = datetime(now.year - s.power_history_years, 1, 1)
    params = {
        "parameters": ",".join(POWER_PARAMS), "community": "AG", "longitude": f"{lon:.4f}", "latitude": f"{lat:.4f}",
        "start": start.strftime("%Y%m%d"), "end": (now - timedelta(days=1)).strftime("%Y%m%d"), "format": "JSON",
    }
    last_error: Exception | None = None
    for attempt in range(3):  # retries with exponential backoff
        try:
            r = httpx.get(s.power_base_url, params=params, timeout=s.power_timeout_s)
            if r.status_code == 429 or r.status_code >= 500:
                raise httpx.HTTPStatusError(f"POWER responded {r.status_code}", request=r.request, response=r)
            r.raise_for_status()
            return parse_power(r.json(), cell, lat, lon)
        except AppError:
            raise
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            log.warning("NASA POWER request failed (attempt %s): %s", attempt + 1, exc)
            time.sleep(1.5 * 2**attempt)
    raise AppError(503, "UPSTREAM_UNAVAILABLE", "Climate data source is unavailable right now") from last_error


def put_cache(session: Session, daily: Daily) -> None:
    row = session.exec(select(EnvCache).where(EnvCache.source == SOURCE, EnvCache.cell == daily.cell)).first()
    if row is None:
        row = EnvCache(source=SOURCE, cell=daily.cell, payload={})
    row.payload = daily.to_lists()
    row.last_date = daily.last_date
    row.fetched_at = utcnow()
    session.add(row)
    session.commit()


def get_climate(session: Session, lat: float, lon: float) -> Climate:
    """Climate context for the 0.5-degree cell containing the point (memory, then database, then POWER)."""
    s = get_settings()
    cell, _, _ = cell_of(lat, lon)
    ttl = s.power_cache_hours * 3600
    hit = _memory.get(cell)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    with _guard:
        lock = _locks.setdefault(cell, threading.Lock())
    with lock:  # one fetch per cell at a time
        hit = _memory.get(cell)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        row = session.exec(select(EnvCache).where(EnvCache.source == SOURCE, EnvCache.cell == cell)).first()
        fetched = row.fetched_at if row else None
        if fetched is not None and fetched.tzinfo is None:
            fetched = fetched.replace(tzinfo=timezone.utc)
        fresh = fetched is not None and (utcnow() - fetched).total_seconds() < ttl
        stale_fallback = False
        daily: Daily | None = None
        if row is not None and (fresh or s.offline_mode):
            daily = Daily.from_lists(row.payload)
        elif not s.offline_mode:
            try:
                daily = _fetch_power(lat, lon, cell)
                put_cache(session, daily)
            except AppError:
                if row is None:
                    raise
                log.warning("Using stale cached climate for cell %s", cell)
                daily = Daily.from_lists(row.payload)  # stale copy is better than nothing; freshness is reported
                stale_fallback = True
        if daily is None:
            raise AppError(503, "UPSTREAM_UNAVAILABLE", "No climate data is available for this location yet")
        daily.from_cache = row is not None
        climate = build_climate(daily)
        # after a failed refresh keep the stale copy in memory for 5 minutes, then try the source again
        _memory[cell] = (time.time() - ttl + 300 if stale_fallback else time.time(), climate)
        return climate


def clear_memory_cache() -> None:
    _memory.clear()
