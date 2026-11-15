"""The Python engine must give the same numbers as the TypeScript engine it was ported from.

Reference values come from frontend/src/lib/engine/export-fixtures.test.ts (tests/fixtures/parity.json).
"""

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.engine.config import crops
from app.engine.features import Daily, SeasonParams, build_climate, dekad_probabilities, monthly_climatology, monthly_series, season_stats
from app.engine.rotation import build_rotation
from app.engine.suitability import PlotCtx, best_window, build_risks, evaluate, scan_year, window_dates

FIX = json.loads((Path(__file__).parent / "fixtures" / "parity.json").read_text(encoding="utf-8"))
TODAY = datetime(2026, 11, 14, tzinfo=timezone.utc)
PLOTS = {
    "rainfed": PlotCtx(False, "none", None, None),
    "drip": PlotCtx(True, "drip", 7.5, "clay"),
}
SNAKE = {
    "tminMean": "tmin_mean", "tmaxMean": "tmax_mean", "absMinT": "abs_min_t", "frostDays": "frost_days",
    "frostYearFraction": "frost_year_fraction", "heatDays": "heat_days", "rainCV": "rain_cv",
    "longestDrySpell": "longest_dry_spell", "extremeRainDays": "extreme_rain_days", "soilWetness": "soil_wetness",
    "effRain": "eff_rain", "tempScore": "temp_score", "waterSatisfaction": "water_satisfaction",
}


@pytest.fixture(scope="module")
def climate():
    return build_climate(Daily.from_lists(FIX["daily"]))


def close(a, b, tol=1e-4):
    if b is None:
        return a is None or (isinstance(a, float) and not math.isfinite(a))
    return a is not None and abs(a - b) <= tol * max(1.0, abs(b))


def test_climate_context(climate):
    ref = FIX["climate"]
    assert climate.s0 == ref["s0"]
    assert (climate.first_year, climate.last_year) == (ref["firstYear"], ref["lastYear"])
    assert climate.et0_method == ref["et0Method"]
    assert close(climate.r95, ref["r95"])
    assert close(climate.completeness, ref["completeness"])
    assert close(climate.record_years, ref["recordYears"])
    assert close(float(sum(0 if math.isnan(x) else x for x in climate.et0)), ref["et0_sum"])
    for k, want in enumerate(ref["et0_head"]):
        assert close(climate.et0[k], want), k


def test_season_stats(climate):
    s = season_stats(climate, SeasonParams(11, 11, 240, 5, 27))
    for k, want in FIX["season_plain"].items():
        assert close(getattr(s, SNAKE.get(k, k)), want), k


def test_monthly_and_dekads(climate):
    rows = monthly_series(climate)
    ref = FIX["monthly"]
    assert len(rows) == ref["count"]
    for name, pick in (("t_clim", lambda r: r.t), ("rain_clim", lambda r: r.rain), ("gwr_clim", lambda r: r.gwr)):
        got = monthly_climatology(rows, pick)
        assert all(close(g, w) for g, w in zip(got, ref[name])), name
    for key, row in (("last", rows[-1]), ("row50", rows[50])):
        for f in ("key", "year", "month", "days"):
            assert getattr(row, f) == ref[key][f]
        for f in ("t", "tmin", "tmax", "rh", "rs", "rain", "gwt", "gwr", "et0"):
            assert close(getattr(row, f), ref[key][f]), (key, f)
    probs = dekad_probabilities(climate, 27)
    assert all(close(g, w) for g, w in zip(probs["frost"], FIX["dekad_probabilities"]["frost"]))
    assert all(close(g, w) for g, w in zip(probs["heat"], FIX["dekad_probabilities"]["heat"]))


def test_window_dates():
    for key, want in FIX["window_dates"].items():
        a, b = (int(x) for x in key.split("-"))
        assert window_dates(a, b, TODAY) == want, key


@pytest.mark.parametrize("key", sorted(FIX["evaluations"]))
def test_evaluations_match(climate, key):
    crop_id, plot_key = key.split("|")
    ref = FIX["evaluations"][key]
    plot = PLOTS[plot_key]
    evals = scan_year(climate, crops()[crop_id], plot)
    for k, want in enumerate(ref["scores"]):
        assert close(evals[k].score, want, 1e-3), (key, k, evals[k].score, want)
    assert best_window(evals) == ref["window"]
    e = evals[ref["at"]]
    for name, want in ref["factors"].items():
        assert close(e.factors[name], want, 1e-3), name
    for name, want in ref["penalties"].items():
        assert close(e.penalties[name], want, 1e-3), name
    assert close(e.rain_reliability, ref["rainReliability"])
    for name, want in ref["stats"].items():
        assert close(getattr(e.stats, SNAKE.get(name, name)), want, 1e-3), name
    assert [[r["type"], r["severity"]] for r in build_risks(climate, e, plot, -0.12)] == ref["risks"]


def test_single_evaluations(climate):
    assert close(evaluate(climate, crops()["wheat"], 31, PLOTS["rainfed"]).score, FIX["single"]["wheat_d31_rainfed"], 1e-3)
    assert close(evaluate(climate, crops()["tomato"], 12, PLOTS["drip"]).score, FIX["single"]["tomato_d12_drip"], 1e-3)


@pytest.mark.parametrize("case", sorted(FIX["rotation"]))
def test_rotation_matches(climate, case):
    ref = FIX["rotation"][case]
    p = ref["input"]["plot"]
    plot = PlotCtx(p["irrigation_available"], p["irrigation_method"], p["soil_ph"], p["soil_type"])
    out = build_rotation(climate, plot, p["current_crop_id"], p["previous_crop_id"], ref["input"]["history"], ref["input"]["priority"], TODAY)
    assert out["seasons"] == ref["seasons"]
    assert [s["key"] for s in out["strategies"]] == ["current", "option_a", "option_b"]
    for got, want in zip(out["strategies"], ref["strategies"]):
        assert got["focus"] == want["focus"]
        assert got["sequence"] == want["sequence"], (case, got["key"])
        assert got["scores"] == want["scores"], (case, got["key"])
        assert len(got["information_gaps"]) == want["gaps"]
        assert len(got["risks_for_review"]) == want["review"]
        assert len(got["why"]) == want["why"]
        assert len(got["benefits"]) == want["benefits"]
