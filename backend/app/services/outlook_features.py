"""Model input features for one grid point at any forecast origin date.

This is the AI team's own feature code, copied from their notebook
`Multi_Horizon_Feature_Engineering.ipynb` (sections 1, 3, 4 and the input half of `build_site`).
Nothing is re-derived here: the same lags, rolling windows, changes, calendar terms, climatology
(prior complete calendar years, +/- 7 days) and anomalies, in the same order. The label half of
`build_site` is left out because labels are not needed to make a forecast.

`tests/test_outlook.py` checks that the features built here for the demo origin date equal the
team's own `Historical_Demo_Features.parquet`.

Source data: `nasa_final/data/processed/master_2019_2026/Jordan_Master_Dataset_2019_2026_Cleaned.parquet`
(daily, 835 grid points, 2019-12-01 to 2026-08-31). The file is large (47 MB); without it
only the demo origin date is available.
"""

from datetime import date
from functools import lru_cache
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2] / "nasa_final"
MASTER = PACKAGE / "data" / "processed" / "master_2019_2026" / "Jordan_Master_Dataset_2019_2026_Cleaned.parquet"

# ---- constants, as in the notebook ----
META = ["GRID_ID", "DATE", "LATITUDE", "LONGITUDE"]
DYNAMIC = "T2M T2M_MAX T2M_MIN RH2M ALLSKY_SFC_SW_DWN WS2M PRECTOTCORR T2MDEW PS SFMC RZMC PRMC GWETTOP GWETROOT GWETPROF IMERG_PRECTOT IMERG_PRECLIQUID_PROB".split()
TARGETS = ["T2M", "RH2M", "SFMC", "IMERG_PRECTOT"]
LAGS = [0, 1, 2, 3, 7, 14, 29, 60, 90, 365]
WINDOWS = [3, 7, 14, 30, 60, 90]
ROLL = ["T2M", "T2M_MAX", "T2M_MIN", "RH2M", "SFMC", "RZMC", "WS2M", "ALLSKY_SFC_SW_DWN", "PS"]
RAIN = ["IMERG_PRECTOT", "PRECTOTCORR"]
PERIODS = [7, 30, 90]
IMPUTED_DATE = "2025-09-20"
# The notebook starts origins at 2021-01-01: 2020 is the first complete year for the climatology
# and a 365-day lag needs a year of history.
FIRST_ORIGIN = date(2021, 1, 1)


def available() -> bool:
    return MASTER.exists()


@lru_cache(maxsize=1)
def coverage() -> tuple[date, date] | None:
    """First and last origin date that features can be built for."""
    if not available():
        return None
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    last = pc.max(pq.read_table(MASTER, columns=["DATE"])["DATE"]).as_py()
    return FIRST_ORIGIN, (last.date() if hasattr(last, "date") else last)


def seasonal_day(dates):
    import numpy as np
    import pandas as pd

    d = pd.DatetimeIndex(dates)
    # Map month/day onto a non-leap calendar.
    day = d.dayofyear.to_numpy() - 1
    day = day - (d.is_leap_year & (d.month > 2)).astype(int)
    day = np.where((d.month == 2) & (d.day == 29), 58, day)
    return day.astype(int)


def climatology(site, year):
    import numpy as np
    import pandas as pd

    history = site[(site.DATE.dt.year >= 2020) & (site.DATE.dt.year < year)].copy()
    assert len(history) > 0
    history.loc[history.DATE.eq(pd.Timestamp(IMPUTED_DATE)), "SFMC"] = np.nan
    keys = seasonal_day(history.DATE)
    sums = history[TARGETS].groupby(keys).sum().reindex(range(365), fill_value=0).to_numpy()
    counts = history[TARGETS].groupby(keys).count().reindex(range(365), fill_value=0).to_numpy()
    sums = sum(np.roll(sums, k, axis=0) for k in range(-7, 8))
    counts = sum(np.roll(counts, k, axis=0) for k in range(-7, 8))
    assert (counts > 0).all()
    return sums / counts


def next_season(d):
    import pandas as pd

    starts = pd.DatetimeIndex([pd.Timestamp(y, m, 1) for y in range(d.min().year, d.max().year + 2) for m in (3, 6, 9, 12)])
    starts = starts.sort_values()
    idx = starts.searchsorted(pd.DatetimeIndex(d), side="right")
    return pd.Series(starts[idx], index=d.index)


def agg_name(c):
    return "sum" if c == "IMERG_PRECTOT" else "mean"


def build_site_features(site, static_row, static_cols):
    """The input half of the notebook's `build_site`: one row of features per day of the site."""
    import numpy as np
    import pandas as pd

    IMPUTED = pd.Timestamp(IMPUTED_DATE)
    site = site.sort_values("DATE").reset_index(drop=True)
    d = site.DATE
    f = {}
    for c in DYNAMIC:
        for lag in LAGS:
            f[f"{c}_lag_{lag}"] = site[c].shift(lag)
    for c in ROLL:
        for w in WINDOWS:
            r = site[c].rolling(w, min_periods=w)
            f[f"{c}_rolling_{w}_mean"] = r.mean()
            f[f"{c}_rolling_{w}_std"] = r.std(ddof=0)
    for c in RAIN:
        for w in WINDOWS:
            f[f"{c}_rolling_{w}_sum"] = site[c].rolling(w, min_periods=w).sum()
    for c in ["T2M", "RH2M", "SFMC", "PS"]:
        for lag in [1, 3, 7, 14]:
            f[f"{c}_change_{lag}"] = site[c] - site[c].shift(lag)
    f["T2M_diurnal_range"] = site.T2M_MAX - site.T2M_MIN
    f["SMAP_imputed_last30"] = d.eq(IMPUTED).rolling(30, min_periods=30).sum()
    f["SMAP_imputed_last90"] = d.eq(IMPUTED).rolling(90, min_periods=90).sum()
    f["SMAP_imputed_lag365"] = d.eq(IMPUTED).shift(365).astype(float)
    day = seasonal_day(d)
    f["Day_Sin"] = np.sin(2 * np.pi * day / 365)
    f["Day_Cos"] = np.cos(2 * np.pi * day / 365)
    f["Month_Sin"] = np.sin(2 * np.pi * (d.dt.month - 1) / 12)
    f["Month_Cos"] = np.cos(2 * np.pi * (d.dt.month - 1) / 12)
    ss = next_season(d)
    se = ss + pd.DateOffset(months=3) - pd.Timedelta(days=1)
    f["Season_lead_days"] = (ss - d).dt.days
    f["Season_length_days"] = (se - ss).dt.days + 1
    f["Season_start_sin"] = np.sin(2 * np.pi * seasonal_day(ss) / 365)
    f["Season_start_cos"] = np.cos(2 * np.pi * seasonal_day(ss) / 365)
    # Baselines / features for each horizon at the forecast origin.
    climate = {f"{c}_clim_h{h}": np.full(len(site), np.nan) for c in TARGETS for h in range(31)}
    climate.update({f"{c}_clim_{agg_name(c)}_{h}d": np.full(len(site), np.nan) for c in TARGETS for h in PERIODS})
    climate.update({f"{c}_clim_{agg_name(c)}_season": np.full(len(site), np.nan) for c in TARGETS})
    for year in sorted(d.dt.year.unique()):
        if year < 2021:
            continue
        idx = np.flatnonzero(d.dt.year.to_numpy() == year)
        clim = climatology(site, year)
        for h in range(31):
            keys = seasonal_day(d.iloc[idx] + pd.Timedelta(days=h))
            for j, c in enumerate(TARGETS):
                climate[f"{c}_clim_h{h}"][idx] = clim[keys, j]
        # Use exact calendar offsets, including leap dates.
        cube = np.stack([clim[seasonal_day(d.iloc[idx] + pd.Timedelta(days=h))] for h in range(1, 91)], axis=1)
        for h in PERIODS:
            for j, c in enumerate(TARGETS):
                a = cube[:, :h, j]
                climate[f"{c}_clim_{agg_name(c)}_{h}d"][idx] = a.sum(axis=1) if c == "IMERG_PRECTOT" else a.mean(axis=1)
        for start in ss.iloc[idx].unique():
            start = pd.Timestamp(start)
            end = start + pd.DateOffset(months=3) - pd.Timedelta(days=1)
            a = clim[seasonal_day(pd.date_range(start, end))]
            ix = idx[ss.iloc[idx].eq(start).to_numpy()]
            for j, c in enumerate(TARGETS):
                climate[f"{c}_clim_{agg_name(c)}_season"][ix] = a[:, j].sum() if c == "IMERG_PRECTOT" else a[:, j].mean()
    f.update(climate)
    for c in TARGETS:
        f[f"{c}_anomaly"] = site[c].to_numpy() - climate[f"{c}_clim_h0"]
    f.update({c: np.full(len(site), static_row[c]) for c in static_cols})
    features = pd.DataFrame(f, index=site.index).astype("float32")
    metadata = site[META].assign(SEASON_START=ss, SEASON_END=se)
    return pd.concat([metadata, features], axis=1)


@lru_cache(maxsize=24)
def _site_frame(grid_id: str):
    """All feature rows of one grid point (cached: building takes about a second)."""
    import pandas as pd
    import pyarrow.parquet as pq

    names = pq.ParquetFile(MASTER).schema_arrow.names
    static_cols = [c for c in names if c not in META + DYNAMIC]
    site = pd.read_parquet(MASTER, filters=[("GRID_ID", "==", grid_id)])
    if site.empty:
        raise KeyError(grid_id)
    site["DATE"] = pd.to_datetime(site["DATE"])
    site = site.sort_values("DATE").reset_index(drop=True)
    return build_site_features(site[META + DYNAMIC], site.iloc[0][static_cols], static_cols)


def features_for(grid_id: str, origin: date):
    """One-row DataFrame of model inputs for `grid_id` at forecast origin `origin`."""
    import pandas as pd

    frame = _site_frame(grid_id)
    row = frame.loc[frame.DATE.eq(pd.Timestamp(origin))]
    if row.empty:
        raise KeyError(origin)
    return row.copy()
