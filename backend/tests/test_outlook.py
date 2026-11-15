"""Forecast outlook: the AI team's package (backend/nasa_final) behind /api/v1/outlook, with the real dataset and saved models."""

from datetime import date

import pytest
from sqlmodel import Session, select

from app.core import db
from app.models import Analysis, Forecast
from app.services import outlook_features

from .conftest import API

pytest.importorskip("pandas")
pytest.importorskip("pyarrow")
pytest.importorskip("xgboost")

IRBID = {"lat": 32.5568, "lon": 35.8469}  # this grid point has no soil data in the team's table
WEST_IRBID = {"lat": 32.551, "lon": 35.752}  # this one has
needs_master = pytest.mark.skipif(not outlook_features.available(), reason="the team's master dataset is not in this checkout")
COMPONENTS = {"temperature", "water", "rotation", "texture_drainage", "soil_ph", "fertility", "humidity", "rainfall", "terrain"}


def test_status_reports_dates_crops_and_previous_crop_list(client):
    s = client.get(f"{API}/outlook/status").json()
    assert s["available"] is True and s["forecast_origin"] == "2026-05-01" and s["rule_version"] == "mvp-2"
    assert s["default_planting_date"] == "2026-05-02" and s["horizons_days"] == [30, 90]
    assert s["planting_date_min"] <= s["default_planting_date"] <= s["planting_date_max"]
    assert len(s["crops"]) == 6 and {c["horizon_days"] for c in s["crops"]} == {30, 90} and sum(s["weights"].values()) == 100
    previous = {p["crop_id"]: p for p in s["previous_crops"]}
    # crops outside the six candidates can be chosen as the previous crop
    assert {"wheat", "barley", "tomato", "potato", "cucumber", "onion", "cabbage", "other"} <= set(previous)
    assert previous["wheat"]["family"] == "Poaceae" and previous["tomato"]["family"] == "Solanaceae" and previous["other"]["family"] is None


# 7: both forecasting horizons work, with every part of the answer ---------------------------------


def test_both_horizons_with_real_forecasts_soil_and_history(client):
    body = {**WEST_IRBID, "irrigation_available": True, "previous_crop": "radish", "previous_crop_year": 2025, "crop_history": [{"year": 2024, "crop_id": "wheat"}], "cultivation_type": "open_field"}
    r = client.post(f"{API}/outlook", json=body)
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["saved"] is False and o["rule_version"] == "mvp-2" and sum(o["weights"].values()) == 100 and o["weight_policy"]["ar"]
    assert o["planting_date"] == "2026-05-02" and o["forecast_origin"] == "2026-05-01"
    assert o["location"]["governorate"]["id"] == "ir" and o["grid"]["id"].startswith("JOR_") and o["grid"]["distance_km"] < 15
    assert [(p["crop_id"], p["years_ago"], p["family"]) for p in o["previous_crops"]] == [("radish", 1, "Brassicaceae"), ("wheat", 2, "Poaceae")]
    # soil and terrain are looked up, with the source of every value
    keys = {p["key"] for p in o["soil"]["properties"]}
    assert {"ph", "sand", "silt", "clay", "organic_carbon", "nitrogen", "cec", "bulk_density", "coarse_fragments"} <= keys
    assert all(p["source"].startswith("ISRIC SoilGrids") for p in o["soil"]["properties"]) and o["soil"]["kind"] == "static_property"
    assert o["soil"]["texture_class"]["0-30"] and o["terrain"]["kind"] == "static_property" and o["terrain"]["slope_pct"] is not None
    assert [p["horizon_days"] for p in o["periods"]] == [30, 90]
    assert [(p["period_start"], p["period_end"]) for p in o["periods"]] == [("2026-05-02", "2026-05-31"), ("2026-05-02", "2026-07-30")]
    for p in o["periods"]:
        assert [f["key"] for f in p["forecast"]] == ["temperature_c", "humidity_pct", "soil_moisture_m3_m3", "rainfall_mm"]
        assert all(f["kind"] == "forecast" and f["validation_mae"] is not None and f["method"] in {"baseline", "direct_xgb", "residual_xgb"} for f in p["forecast"])
        recs = p["recommendations"]
        assert len(recs) == 3 and p["status"] in {"ok", "no_suitable_recommendation"}
        for x in recs:
            assert set(x["component_scores"]) == COMPONENTS and set(x["group_scores"]) == {"climate", "water", "soil", "fertility", "rotation"}
            assert 0 <= x["score"] <= 100 and x["coverage_pct"] == 100 and x["missing_factors"] == []
            assert x["rotation"]["evaluated"] is True and x["family"] and x["name"]["ar"] and x["name"]["en"]
            # every score comes with reasons in both languages
            assert x["explanations"] and all(e["ar"] and e["en"] and e["effect"] in {"positive", "negative", "caution", "unknown"} for e in x["explanations"])
            assert {e["component"] for e in x["explanations"]} >= {"temperature", "soil_ph", "texture_drainage", "fertility", "rotation"}
        usable = [x for x in recs if x["status"] != "not_recommended"]
        assert [x["score"] for x in usable] == sorted((x["score"] for x in usable), reverse=True)
    assert o["warnings"] and all(w["ar"] and w["en"] for w in o["warnings"])
    # the 90-day temperature comes from the trained model, not a baseline formula
    t90 = o["periods"][1]["forecast"][0]
    assert t90["method"] == "direct_xgb" and 5 < t90["value"] < 45
    # one horizon can be asked for on its own
    only = client.post(f"{API}/outlook", json={**body, "horizon_days": 90}).json()
    assert [p["horizon_days"] for p in only["periods"]] == [90] and only["periods"][0]["recommendations"] == o["periods"][1]["recommendations"]


def test_the_wrapper_returns_what_the_teams_own_endpoint_returns(client):
    from nasa_final.AI import recommendation_api as team

    body = {"irrigation_available": True, "previous_crop": "spinach"}
    mine = client.post(f"{API}/outlook", json={**WEST_IRBID, **body}).json()
    theirs = team.demo(team.DemoRequest(latitude=WEST_IRBID["lat"], longitude=WEST_IRBID["lon"], **body))
    for p in mine["periods"]:
        t = theirs["periods"][str(p["horizon_days"])]
        assert {f["key"]: f["value"] for f in p["forecast"]} == t["forecast"]
        assert [(x["crop_id"], x["score"], x["status"]) for x in p["recommendations"]] == [(x["crop_id"], x["score"], x["status"]) for x in t["recommendations"]]


def test_previous_crop_changes_the_ranking_at_the_same_place_and_date(client):
    rank = lambda prev: [x["crop_id"] for x in client.post(f"{API}/outlook", json={**WEST_IRBID, "irrigation_available": True, "horizon_days": 30, "previous_crop": prev}).json()["periods"][0]["recommendations"]]  # noqa: E731
    assert rank("radish") != rank("spinach")
    assert rank("radish")[-1] == "radish" and rank("spinach")[-1] == "spinach"  # the repeated crop drops to the bottom
    unknown = client.post(f"{API}/outlook", json={**WEST_IRBID, "horizon_days": 30}).json()["periods"][0]["recommendations"][0]
    assert unknown["component_scores"]["rotation"] is None and unknown["coverage_pct"] == 80
    bad = client.post(f"{API}/outlook", json={**WEST_IRBID, "previous_crop": "mango"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "UNSUPPORTED_CROP"


def test_outlook_stores_nothing(client):
    client.post(f"{API}/outlook", json=IRBID)
    with Session(db.get_engine()) as s:
        assert s.exec(select(Forecast)).first() is None and s.exec(select(Analysis)).first() is None


def test_irrigation_changes_the_water_factors(client):
    dry = client.post(f"{API}/outlook", json={**IRBID, "irrigation_available": False}).json()
    wet = client.post(f"{API}/outlook", json={**IRBID, "irrigation_available": True}).json()
    d, w = dry["periods"][1]["recommendations"][0]["component_scores"], wet["periods"][1]["recommendations"][0]["component_scores"]
    assert w["rainfall"] == 100 and d["rainfall"] < 100 and w["water"] >= d["water"]


# 5: missing soil is unknown, never fabricated -----------------------------------------------------


def test_soil_comes_from_the_dataset_and_is_never_invented(client):
    has = client.get(f"{API}/outlook/soil", params=WEST_IRBID).json()
    props = {x["key"]: x for x in has["soil"]["properties"]}
    assert has["soil"]["source"] == "ISRIC SoilGrids" and 3 < props["ph"]["value"] < 11
    assert 95 < props["sand"]["value"] + props["silt"]["value"] + props["clay"]["value"] < 105
    assert has["terrain"]["elevation_m"] is not None
    # where the dataset has no soil value, the soil factors are unknown and the coverage says so
    none = client.get(f"{API}/outlook/soil", params=IRBID).json()
    assert none["soil"] is None and none["terrain"]["slope_pct"] is not None
    o = client.post(f"{API}/outlook", json={**IRBID, "previous_crop": "wheat"}).json()
    assert o["soil"] is None
    r = o["periods"][0]["recommendations"][0]
    assert r["component_scores"]["soil_ph"] is None and r["component_scores"]["texture_drainage"] is None and r["component_scores"]["fertility"] is None
    assert set(r["missing_factors"]) == {"soil_ph", "texture_drainage", "fertility"} and r["coverage_pct"] == 70
    assert {e["component"] for e in r["explanations"] if e["effect"] == "unknown"} >= {"soil_ph", "texture_drainage", "fertility"}
    # a laboratory value replaces the estimate and keeps its source
    lab = client.post(f"{API}/outlook", json={**IRBID, "soil_lab": {"ph": 6.8}}).json()
    assert lab["soil"]["properties"] == [{"key": "ph", "value": 6.8, "unit": "pH", "source": "laboratory result (user)"}] and lab["soil"]["has_laboratory_values"] is True
    assert lab["periods"][0]["recommendations"][0]["component_scores"]["soil_ph"] is not None
    est = client.post(f"{API}/outlook", json={**WEST_IRBID, "horizon_days": 30}).json()
    lab2 = client.post(f"{API}/outlook", json={**WEST_IRBID, "horizon_days": 30, "soil_lab": {"ph": 6.8}}).json()
    score = lambda o: {x["crop_id"]: x["component_scores"]["soil_ph"] for x in o["periods"][0]["recommendations"]}  # noqa: E731
    assert score(lab2)["radish"] == 100 and score(est)["radish"] < 100  # estimated pH here is about 8


def test_outside_jordan_is_refused(client):
    for call in (client.post(f"{API}/outlook", json={"lat": 30.0, "lon": 30.0}), client.get(f"{API}/outlook/soil", params={"lat": 30.0, "lon": 30.0})):
        assert call.status_code == 422 and call.json()["error"]["code"] == "UNSUPPORTED_LOCATION"


# 8: historical data is never presented as a live forecast -----------------------------------------


def test_historical_data_is_labelled_and_never_served_as_live(client):
    default = client.post(f"{API}/outlook", json=WEST_IRBID).json()
    assert default["data_mode"] == "historical_demo" and default["is_default_date"] is True and default["forecast_origin"] == "2026-05-01"
    # today's date is outside the dataset: it is refused, not answered from the snapshot
    r = client.post(f"{API}/outlook", json={**WEST_IRBID, "planting_date": str(date(2026, 11, 16))})
    assert r.status_code == 422 and r.json()["error"]["code"] == "DATE_OUT_OF_RANGE" and r.json()["error"]["details"]["default"] == "2026-05-02"
    assert "live" not in default["data_mode"] and "current" not in default["data_mode"]
    # untrained variables are never returned as forecasts
    for p in default["periods"]:
        assert {f["variable"] for f in p["forecast"]} == {"T2M", "RH2M", "SFMC", "IMERG_PRECTOT"}
        h = p["historical_indicators"]
        if h is not None:
            assert h["kind"] == "historical_observation" and "Not a forecast" in h["note"] and max(h["years"]) < 2026


@needs_master
def test_features_built_here_equal_the_teams_demo_features():
    """The feature code copied from the team's notebook reproduces their demo snapshot exactly."""
    import numpy as np
    import pandas as pd

    demo = pd.read_parquet(outlook_features.PACKAGE / "data" / "demo" / "Historical_Demo_Features.parquet")
    for gid in ("JOR_0001", "JOR_0751"):
        mine = outlook_features.features_for(gid, date(2026, 5, 1))
        ref = demo.loc[demo.GRID_ID.eq(gid)]
        assert list(mine.columns) == list(ref.columns)
        num = [c for c in ref.columns if c not in ("GRID_ID", "DATE", "SEASON_START", "SEASON_END")]
        a, b = mine[num].to_numpy(dtype="float64")[0], ref[num].to_numpy(dtype="float64")[0]
        assert np.array_equal(a, b, equal_nan=True)
        assert str(mine.SEASON_START.iloc[0]) == str(ref.SEASON_START.iloc[0]) and str(mine.SEASON_END.iloc[0]) == str(ref.SEASON_END.iloc[0])


@needs_master
def test_planting_date_moves_the_forecast_period_and_the_historical_window(client):
    r = client.post(f"{API}/outlook", json={**WEST_IRBID, "planting_date": "2025-11-15"})
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["data_mode"] == "historical_data" and o["is_default_date"] is False
    assert o["planting_date"] == "2025-11-15" and o["forecast_origin"] == "2025-11-14"
    assert [(p["period_start"], p["period_end"]) for p in o["periods"]] == [("2025-11-15", "2025-12-14"), ("2025-11-15", "2026-02-12")]
    spring = client.post(f"{API}/outlook", json=WEST_IRBID).json()
    assert o["periods"][0]["forecast"][0]["value"] < spring["periods"][0]["forecast"][0]["value"]  # mid-November is cooler than May
    h = o["periods"][0]["historical_indicators"]
    assert h["kind"] == "historical_observation" and h["window_days"] == 30 and max(h["years"]) <= 2024  # only windows that ended before the planting date
    assert h["t2m_min_mean_c"] < h["t2m_max_mean_c"] and 0 <= h["frost_frequency"] <= 1 and 0 < h["root_zone_moisture_m3_m3"] < 1
    # asking for the default date explicitly gives exactly the default answer
    same = client.post(f"{API}/outlook", json={**WEST_IRBID, "planting_date": "2026-05-02"}).json()
    assert same["periods"] == spring["periods"] and same["is_default_date"] is True
