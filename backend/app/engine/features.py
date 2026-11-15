"""Feature engineering from the daily climate record.

Port of frontend/src/lib/climate/features.ts. tests/test_engine_parity.py checks that both
implementations give the same numbers, so change them together.

Definitions
- ET0: FAO-56 Penman-Monteith (Allen et al. 1998, eq. 6); Hargreaves (eq. 52) when inputs are missing.
- ETc = Kc x ET0 with the FAO-56 four-stage Kc curve.
- Frost day: Tmin < 0 C (ETCCDI FD). Dry day: precipitation < 1 mm (ETCCDI CDD).
- Extreme rain day: precipitation above the local 95th percentile of wet days (ETCCDI R95p).
- Effective rainfall: USDA-SCS monthly formula as used in FAO CROPWAT (needs local review).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Callable, Optional

import numpy as np

EPOCH = date(1970, 1, 1).toordinal()
DEKADS = 36


def to_day(iso: str) -> int:
    return date.fromisoformat(iso).toordinal() - EPOCH


def from_day(d: int) -> str:
    return date.fromordinal(d + EPOCH).isoformat()


def js_round(x: float) -> int:
    """Math.round semantics (half rounds up), unlike Python's banker's rounding."""
    return int(math.floor(x + 0.5))


def r0(x: float) -> int:
    return js_round(x)


def r1(x: float) -> float:
    return js_round(x * 10) / 10


@dataclass
class Daily:
    """Daily record for one location. Arrays are float with NaN for missing values."""

    lat: float
    lon: float
    elevation: float
    start: str  # ISO date of index 0
    last_date: str  # last date that has a temperature value
    t: np.ndarray
    tmin: np.ndarray
    tmax: np.ndarray
    rh: np.ndarray
    ws: np.ndarray
    rs: np.ndarray
    pr: np.ndarray
    gwt: np.ndarray
    gwr: np.ndarray
    cell: str = ""
    fetched_at: str = ""
    from_cache: bool = False

    @property
    def days(self) -> int:
        return len(self.t)

    @staticmethod
    def from_lists(d: dict) -> "Daily":
        arr = lambda k: np.array([np.nan if v is None else v for v in d[k]], dtype=float)  # noqa: E731
        return Daily(
            lat=d["lat"], lon=d["lon"], elevation=d.get("elevation", 0.0), start=d["start"],
            last_date=d.get("lastDate") or d.get("last_date"),
            t=arr("t"), tmin=arr("tmin"), tmax=arr("tmax"), rh=arr("rh"), ws=arr("ws"), rs=arr("rs"),
            pr=arr("pr"), gwt=arr("gwt"), gwr=arr("gwr"),
            cell=d.get("cell", ""), fetched_at=d.get("fetchedAt") or d.get("fetched_at", ""),
        )

    def to_lists(self) -> dict:
        lst = lambda a: [None if math.isnan(v) else round(float(v), 2) for v in a]  # noqa: E731
        return {
            "lat": self.lat, "lon": self.lon, "elevation": self.elevation, "start": self.start, "last_date": self.last_date,
            "cell": self.cell, "fetched_at": self.fetched_at,
            "t": lst(self.t), "tmin": lst(self.tmin), "tmax": lst(self.tmax), "rh": lst(self.rh), "ws": lst(self.ws),
            "rs": lst(self.rs), "pr": lst(self.pr), "gwt": lst(self.gwt), "gwr": lst(self.gwr),
        }


# ---------------- reference evapotranspiration ----------------


def extraterrestrial_radiation(lat_deg: float, J: int) -> float:
    """Ra in MJ/m2/day (FAO-56 eq. 21)."""
    phi = math.radians(lat_deg)
    dr = 1 + 0.033 * math.cos(2 * math.pi * J / 365)
    delta = 0.409 * math.sin(2 * math.pi * J / 365 - 1.39)
    ws = math.acos(max(-1.0, min(1.0, -math.tan(phi) * math.tan(delta))))
    return (24 * 60 / math.pi) * 0.082 * dr * (ws * math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.sin(ws))


def _svp(T: float) -> float:
    return 0.6108 * math.exp(17.27 * T / (T + 237.3))


def et0_penman_monteith(tmin: float, tmax: float, rh: float, ws: float, rs: float, lat: float, elevation: float, J: int) -> float:
    """FAO-56 Penman-Monteith reference ET (mm/day). RH is the daily mean (eq. 19)."""
    tmean = (tmin + tmax) / 2
    P = 101.3 * ((293 - 0.0065 * elevation) / 293) ** 5.26
    gamma = 0.000665 * P
    es = (_svp(tmax) + _svp(tmin)) / 2
    ea = (max(0.0, min(100.0, rh)) / 100) * es
    delta = 4098 * _svp(tmean) / (tmean + 237.3) ** 2
    Ra = extraterrestrial_radiation(lat, J)
    Rso = (0.75 + 2e-5 * elevation) * Ra
    Rns = 0.77 * rs
    rel = min(1.0, rs / Rso) if Rso > 0 else 0.5
    Rnl = 4.903e-9 * (((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2) * (0.34 - 0.14 * math.sqrt(ea)) * (1.35 * rel - 0.35)
    Rn = Rns - Rnl
    et0 = (0.408 * delta * Rn + (gamma * 900 / (tmean + 273)) * ws * (es - ea)) / (delta + gamma * (1 + 0.34 * ws))
    return max(0.0, et0)


def et0_hargreaves(tmin: float, tmax: float, lat: float, J: int) -> float:
    Ra = extraterrestrial_radiation(lat, J)
    return max(0.0, 0.0023 * ((tmin + tmax) / 2 + 17.8) * math.sqrt(max(0.0, tmax - tmin)) * 0.408 * Ra)


def day_of_year(day_index: int) -> int:
    d = date.fromordinal(day_index + EPOCH)
    return d.timetuple().tm_yday


def compute_et0(d: Daily) -> tuple[np.ndarray, str]:
    s0 = to_day(d.start)
    out = np.full(d.days, np.nan)
    pm = hg = 0
    for k in range(d.days):
        tmin, tmax = d.tmin[k], d.tmax[k]
        if math.isnan(tmin) or math.isnan(tmax):
            continue
        J = day_of_year(s0 + k)
        rh, ws, rs = d.rh[k], d.ws[k], d.rs[k]
        if not (math.isnan(rh) or math.isnan(ws) or math.isnan(rs)):
            pm += 1
            out[k] = et0_penman_monteith(tmin, tmax, rh, ws, rs, d.lat, d.elevation, J)
        else:
            hg += 1
            out[k] = et0_hargreaves(tmin, tmax, d.lat, J)
    method = "penman_monteith" if hg == 0 else "hargreaves" if pm == 0 else "mixed"
    return out, method


# ---------------- crop coefficient curve ----------------


def scale_stages(stages: list[int], total: int) -> list[int]:
    """Scale FAO-56 stage lengths to another season length, keeping proportions."""
    s_sum = sum(stages)
    s = [max(1, js_round(x / s_sum * total)) for x in stages]
    s[2] += total - sum(s)
    return s


def kc_at(n: int, stages: list[int], kc: dict) -> float:
    li, ld, lm, ll = stages
    if n < li:
        return kc["ini"]
    if n < li + ld:
        return kc["ini"] + (n - li) / ld * (kc["mid"] - kc["ini"])
    if n < li + ld + lm:
        return kc["mid"]
    if n < li + ld + lm + ll:
        return kc["mid"] + (n - li - ld - lm) / ll * (kc["end"] - kc["mid"])
    return kc["end"]


def kc_curve(length: int, stages: list[int], kc: dict) -> np.ndarray:
    return np.array([kc_at(n, stages, kc) for n in range(length)])


def effective_rain_monthly(p: float) -> float:
    """Monthly effective rainfall (mm), USDA-SCS formula used in FAO CROPWAT."""
    return p * (125 - 0.2 * p) / 125 if p <= 250 else 125 + 0.1 * p


# ---------------- statistics helpers (JS-compatible) ----------------


def _mean(xs) -> float:
    xs = list(xs)
    return sum(xs) / len(xs) if xs else math.nan


def _std(xs) -> float:
    xs = list(xs)
    if len(xs) < 2:
        return 0.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def _quantile(xs, q: float) -> float:
    s = sorted(xs)
    if not s:
        return math.nan
    pos = (len(s) - 1) * q
    lo = int(math.floor(pos))
    return s[lo] + (s[min(lo + 1, len(s) - 1)] - s[lo]) * (pos - lo)


def _nanmean(a: np.ndarray) -> float:
    v = a[~np.isnan(a)]
    return float(v.mean()) if v.size else math.nan


# ---------------- climate context ----------------


@dataclass
class Climate:
    daily: Daily
    et0: np.ndarray
    et0_method: str
    s0: int
    first_year: int
    last_year: int
    r95: float  # local threshold of an "extreme rain day" (mm/day)
    completeness: float
    record_years: float
    ym: np.ndarray  # year*12 + month index for every day
    last_idx: int
    _cache: dict = field(default_factory=dict, repr=False)


def build_climate(daily: Daily) -> Climate:
    et0, method = compute_et0(daily)
    s0 = to_day(daily.start)
    wet = daily.pr[~np.isnan(daily.pr)]
    wet = wet[wet >= 1]
    last = to_day(daily.last_date) - s0 + 1
    have = int(np.count_nonzero(~np.isnan(daily.t[:last])))
    ym = np.empty(daily.days, dtype=np.int64)
    d0 = date.fromordinal(s0 + EPOCH)
    for k in range(daily.days):
        dt = d0 + timedelta(days=k)
        ym[k] = dt.year * 12 + dt.month - 1
    return Climate(
        daily=daily, et0=et0, et0_method=method, s0=s0,
        first_year=int(daily.start[:4]), last_year=int(daily.last_date[:4]),
        r95=_quantile(wet.tolist(), 0.95) if wet.size else math.nan,
        completeness=have / last if last else 0.0,
        record_years=last / 365.25, ym=ym, last_idx=last - 1,
    )


# ---------------- season statistics ----------------


@dataclass
class SeasonParams:
    start_month: int
    start_day: int
    length_days: int
    t_base: float
    heat_threshold: float
    kc: Optional[dict] = None
    stages: Optional[list[int]] = None
    # vectorised 0-100 suitability of daily mean temperature; averaged over the season
    temp_suitability: Optional[Callable[[np.ndarray], np.ndarray]] = None


@dataclass
class SeasonYear:
    year: int
    tmean: float
    tmin_mean: float
    tmax_mean: float
    abs_min_t: float
    gdd: float
    frost_days: float
    heat_days: float
    rain: float
    longest_dry_spell: float
    extreme_rain_days: float
    rs: float
    soil_wetness: Optional[float]
    et0: float
    etc: float
    eff_rain: float
    irrigation: float
    temp_score: float
    water_satisfaction: float
    establishment: float


@dataclass
class SeasonStats:
    years: list[SeasonYear]
    n: int
    tmean: float
    tmin_mean: float
    tmax_mean: float
    abs_min_t: float
    gdd: float
    frost_days: float
    frost_year_fraction: float
    heat_days: float
    rain: float
    rain_cv: float
    longest_dry_spell: float
    extreme_rain_days: float
    rs: float
    soil_wetness: Optional[float]
    et0: float
    etc: float
    eff_rain: float
    irrigation: float
    temp_score: float
    water_satisfaction: float
    establishment: float


def _longest_run(mask: np.ndarray) -> int:
    if not mask.any():
        return 0
    padded = np.concatenate(([0], mask.astype(np.int8), [0]))
    edges = np.flatnonzero(np.diff(padded))
    return int((edges[1::2] - edges[::2]).max())


def season_stats(c: Climate, p: SeasonParams) -> SeasonStats:
    """Statistics of one candidate season across every year of the record that fully contains it."""
    d = c.daily
    L = p.length_days
    stages = scale_stages(p.stages, L) if p.stages else None
    kc = kc_curve(L, stages, p.kc) if stages and p.kc else np.ones(L)
    ini_days = stages[0] if stages else min(30, L)
    years: list[SeasonYear] = []
    for y in range(c.first_year, c.last_year + 1):
        a = to_day(f"{y}-{p.start_month:02d}-{p.start_day:02d}") - c.s0
        b = a + L
        if a < 0 or b - 1 > c.last_idx:
            continue
        t = d.t[a:b]
        tv = t[~np.isnan(t)]
        if tv.size < L * 0.9:
            continue
        tn = d.tmin[a:b]
        tnv = tn[~np.isnan(tn)]
        pr = np.nan_to_num(d.pr[a:b], nan=0.0)
        e0 = np.nan_to_num(c.et0[a:b], nan=0.0)
        etc_d = e0 * kc
        et0 = float(e0.sum())
        etc = float(etc_d.sum())
        # monthly buckets for effective rainfall and irrigation requirement
        months, inv = np.unique(c.ym[a:b], return_inverse=True)
        p_m = np.bincount(inv, weights=pr, minlength=months.size)
        etc_m = np.bincount(inv, weights=etc_d, minlength=months.size)
        eff = irr = eff_season = 0.0
        for pm_, em_ in zip(p_m.tolist(), etc_m.tolist()):
            er = effective_rain_monthly(pm_)
            e = min(er, em_)
            eff_season += er  # winter surplus is assumed stored in the soil for later months
            eff += e
            irr += max(0.0, em_ - e)
        ini_rain = float(pr[:ini_days].sum())
        ini_etc = float(etc_d[:ini_days].sum())
        gw = d.gwr[a:b]
        gwv = gw[~np.isnan(gw)]
        years.append(
            SeasonYear(
                year=y,
                tmean=float(tv.mean()),
                tmin_mean=_nanmean(tn),
                tmax_mean=_nanmean(d.tmax[a:b]),
                abs_min_t=float(tnv.min()) if tnv.size else math.inf,
                gdd=float(np.maximum(0.0, tv - p.t_base).sum()),
                frost_days=float(np.count_nonzero(tnv < 0)),
                heat_days=float(np.count_nonzero(tv > p.heat_threshold)),
                rain=float(pr.sum()),
                longest_dry_spell=float(_longest_run(pr < 1)),
                extreme_rain_days=float(np.count_nonzero(pr > c.r95)) if math.isfinite(c.r95) else 0.0,
                rs=_nanmean(d.rs[a:b]),
                soil_wetness=float(gwv.mean()) if gwv.size else None,
                et0=et0,
                etc=etc,
                eff_rain=eff,
                irrigation=irr,
                temp_score=float(p.temp_suitability(tv).mean()) if p.temp_suitability is not None and tv.size else math.nan,
                water_satisfaction=min(1.0, eff_season / etc) if etc > 0 else 1.0,
                establishment=min(1.0, ini_rain / ini_etc) if ini_etc > 0 else 1.0,
            )
        )
    col = lambda f: _mean(f(y) for y in years)  # noqa: E731
    rains = [y.rain for y in years]
    sw = [y.soil_wetness for y in years if y.soil_wetness is not None]
    mr = _mean(rains)
    return SeasonStats(
        years=years,
        n=len(years),
        tmean=col(lambda y: y.tmean),
        tmin_mean=col(lambda y: y.tmin_mean),
        tmax_mean=col(lambda y: y.tmax_mean),
        abs_min_t=min((y.abs_min_t for y in years), default=math.nan),
        gdd=col(lambda y: y.gdd),
        frost_days=col(lambda y: y.frost_days),
        frost_year_fraction=sum(1 for y in years if y.frost_days > 0) / len(years) if years else 0.0,
        heat_days=col(lambda y: y.heat_days),
        rain=mr,
        rain_cv=_std(rains) / mr if years and mr > 0 else 0.0,
        longest_dry_spell=col(lambda y: y.longest_dry_spell),
        extreme_rain_days=col(lambda y: y.extreme_rain_days),
        rs=col(lambda y: y.rs),
        soil_wetness=_mean(sw) if sw else None,
        et0=col(lambda y: y.et0),
        etc=col(lambda y: y.etc),
        eff_rain=col(lambda y: y.eff_rain),
        irrigation=col(lambda y: y.irrigation),
        temp_score=col(lambda y: y.temp_score),
        water_satisfaction=col(lambda y: y.water_satisfaction),
        establishment=col(lambda y: y.establishment),
    )


def fraction_of_years_meeting(s: SeasonStats, min_rain: float) -> float:
    return sum(1 for y in s.years if y.rain >= min_rain) / s.n if s.n else 0.0


# ---------------- dekads (10-day periods, 36 per year) ----------------


def dekad_start(k: int) -> tuple[int, int]:
    return k // 3 + 1, (1, 11, 21)[k % 3]


def dekad_of(month: int, day: int) -> int:
    return (month - 1) * 3 + (2 if day >= 21 else 1 if day >= 11 else 0)


def dekad_probabilities(c: Climate, heat_threshold: float) -> dict:
    """Fraction of years with at least one frost day / heat-stress day in each dekad."""
    d = c.daily
    frost = [set() for _ in range(DEKADS)]
    heat = [set() for _ in range(DEKADS)]
    seen = [set() for _ in range(DEKADS)]
    d0 = date.fromordinal(c.s0 + EPOCH)
    for k in range(d.days):
        tn, tm = d.tmin[k], d.t[k]
        if math.isnan(tn) and math.isnan(tm):
            continue
        dt = d0 + timedelta(days=k)
        dk = dekad_of(dt.month, dt.day)
        seen[dk].add(dt.year)
        if not math.isnan(tn) and tn < 0:
            frost[dk].add(dt.year)
        if not math.isnan(tm) and tm > heat_threshold:
            heat[dk].add(dt.year)
    return {
        "frost": [len(frost[i]) / len(seen[i]) if seen[i] else 0.0 for i in range(DEKADS)],
        "heat": [len(heat[i]) / len(seen[i]) if seen[i] else 0.0 for i in range(DEKADS)],
    }


# ---------------- monthly aggregates ----------------


@dataclass
class MonthlyRow:
    key: str  # YYYY-MM
    year: int
    month: int
    t: Optional[float]
    tmin: Optional[float]
    tmax: Optional[float]
    rh: Optional[float]
    rs: Optional[float]
    rain: Optional[float]
    gwt: Optional[float]
    gwr: Optional[float]
    et0: Optional[float]
    days: int


def monthly_series(c: Climate) -> list[MonthlyRow]:
    """Calendar-month aggregates for every month in the record (cached on the climate object)."""
    if "monthly" in c._cache:
        return c._cache["monthly"]
    d = c.daily
    n = c.last_idx + 1
    ym = c.ym[:n]
    months, starts = np.unique(ym, return_index=True)
    bounds = list(starts) + [n]

    def avg(a: np.ndarray):
        v = a[~np.isnan(a)]
        return float(v.mean()) if v.size else None

    def total(a: np.ndarray):
        v = a[~np.isnan(a)]
        return float(v.sum()) * (a.size / v.size) if v.size and v.size >= a.size * 0.8 else None

    rows = []
    for i, m in enumerate(months.tolist()):
        a, b = bounds[i], bounds[i + 1]
        year, month = m // 12, m % 12 + 1
        rows.append(
            MonthlyRow(
                key=f"{year}-{month:02d}", year=year, month=month,
                t=avg(d.t[a:b]), tmin=avg(d.tmin[a:b]), tmax=avg(d.tmax[a:b]), rh=avg(d.rh[a:b]), rs=avg(d.rs[a:b]),
                rain=total(d.pr[a:b]), gwt=avg(d.gwt[a:b]), gwr=avg(d.gwr[a:b]), et0=total(c.et0[a:b]), days=b - a,
            )
        )
    c._cache["monthly"] = rows
    return rows


def monthly_climatology(rows: list[MonthlyRow], pick: Callable[[MonthlyRow], Optional[float]], exclude_key: Optional[str] = None) -> list[Optional[float]]:
    """Mean of each calendar month over full months only (index 0 = January)."""
    out: list[Optional[float]] = []
    for m in range(1, 13):
        v = [pick(r) for r in rows if r.month == m and r.days >= 27 and r.key != exclude_key]
        v = [x for x in v if x is not None]
        out.append(_mean(v) if v else None)
    return out


def coldest_month_mean(c: Climate) -> float:
    if "coldest" not in c._cache:
        clim = [x for x in monthly_climatology(monthly_series(c), lambda r: r.t) if x is not None]
        c._cache["coldest"] = min(clim) if clim else math.nan
    return c._cache["coldest"]
