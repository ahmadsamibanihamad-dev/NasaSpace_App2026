"""Forecast outlook: the AI team's package (backend/nasa_final) behind /api/v1/outlook."""

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


def test_status_reports_dates_and_crops(client):
    s = client.get(f"{API}/outlook/status").json()
    assert s["available"] is True and s["forecast_origin"] == "2026-05-01"
    assert s["default_planting_date"] == "2026-05-02" and s["horizons_days"] == [30, 90]
    assert s["planting_date_min"] <= s["default_planting_date"] <= s["planting_date_max"]
    assert len(s["crops"]) == 6 and {c["horizon_days"] for c in s["crops"]} == {30, 90}


def test_default_date_gives_two_periods_with_three_ranked_crops(client):
    r = client.post(f"{API}/outlook", json={**IRBID, "irrigation_available": True})
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["data_mode"] == "historical_demo" and o["is_default_date"] is True and o["saved"] is False
    assert o["planting_date"] == "2026-05-02" and o["forecast_origin"] == "2026-05-01"
    assert o["location"]["governorate"]["id"] == "ir" and o["grid"]["distance_km"] < 15
    assert [p["horizon_days"] for p in o["periods"]] == [30, 90]
    assert [(p["period_start"], p["period_end"]) for p in o["periods"]] == [("2026-05-02", "2026-05-31"), ("2026-05-02", "2026-07-30")]
    for p in o["periods"]:
        assert [f["key"] for f in p["forecast"]] == ["temperature_c", "humidity_pct", "soil_moisture_m3_m3", "rainfall_mm"]
        assert all(f["validation_mae"] is not None and f["method"] in {"baseline", "direct_xgb", "residual_xgb"} for f in p["forecast"])
        recs = p["recommendations"]
        assert len(recs) == 3
        assert all(0 <= x["score"] <= 100 and x["name"]["ar"] and x["name"]["en"] for x in recs)
        # reasons and cautions are shown to the user in both languages
        assert all(t["ar"] and t["en"] for x in recs for t in x["reasons"] + x["risks"])
        usable = [x for x in recs if x["status"] != "not_recommended"]
        assert [x["score"] for x in usable] == sorted((x["score"] for x in usable), reverse=True)
    assert o["warnings"] and all(w["ar"] and w["en"] for w in o["warnings"])
    # the 90-day temperature comes from the trained model, not a baseline formula
    t90 = o["periods"][1]["forecast"][0]
    assert t90["method"] == "direct_xgb" and 5 < t90["value"] < 45


def test_default_date_matches_the_teams_own_demo_endpoint(client):
    """The wrapper must not change what the team's code answers."""
    from nasa_final.AI import recommendation_api as team

    mine = client.post(f"{API}/outlook", json={**WEST_IRBID, "irrigation_available": True}).json()
    ph = next(x["value"] for x in mine["soil"]["properties"] if x["key"] == "ph")
    theirs = team.demo(team.DemoRequest(latitude=WEST_IRBID["lat"], longitude=WEST_IRBID["lon"], irrigation_available=True, soil_ph=ph))
    for p in mine["periods"]:
        t = theirs["periods"][str(p["horizon_days"])]
        assert {f["key"]: f["value"] for f in p["forecast"]} == t["forecast"]
        assert [(x["crop_id"], x["score"], x["status"]) for x in p["recommendations"]] == [(x["crop_id"], x["score"], x["status"]) for x in t["recommendations"]]


def test_outlook_stores_nothing(client):
    client.post(f"{API}/outlook", json=IRBID)
    with Session(db.get_engine()) as s:
        assert s.exec(select(Forecast)).first() is None and s.exec(select(Analysis)).first() is None


def test_irrigation_changes_the_water_factor(client):
    dry = client.post(f"{API}/outlook", json={**IRBID, "irrigation_available": False}).json()
    wet = client.post(f"{API}/outlook", json={**IRBID, "irrigation_available": True}).json()
    d, w = dry["periods"][1]["recommendations"][0], wet["periods"][1]["recommendations"][0]
    assert w["factor_scores"]["rainfall_proxy"] == 100 and d["factor_scores"]["rainfall_proxy"] < 100


def test_soil_comes_from_the_table_and_is_never_invented(client):
    has = client.get(f"{API}/outlook/soil", params=WEST_IRBID).json()
    props = {x["key"]: x for x in has["soil"]["properties"]}
    assert has["soil"]["source"] == "ISRIC SoilGrids" and 3 < props["ph"]["value"] < 11
    assert 95 < props["sand"]["value"] + props["silt"]["value"] + props["clay"]["value"] < 105
    # pH from the table enters the team's rules
    o = client.post(f"{API}/outlook", json=WEST_IRBID).json()
    assert o["soil"] == has["soil"] and "soil_ph" in o["periods"][0]["recommendations"][0]["factor_scores"]
    # where the table has no value, nothing is made up
    none = client.get(f"{API}/outlook/soil", params=IRBID).json()
    assert none["soil"] is None
    o = client.post(f"{API}/outlook", json=IRBID).json()
    assert o["soil"] is None and "soil_ph" not in o["periods"][0]["recommendations"][0]["factor_scores"]
    # the user cannot push a soil value in
    forced = client.post(f"{API}/outlook", json={**IRBID, "soil_ph": 6.8}).json()
    assert forced["soil"] is None


def test_outside_jordan_is_refused(client):
    for call in (client.post(f"{API}/outlook", json={"lat": 30.0, "lon": 30.0}), client.get(f"{API}/outlook/soil", params={"lat": 30.0, "lon": 30.0})):
        assert call.status_code == 422 and call.json()["error"]["code"] == "UNSUPPORTED_LOCATION"


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
def test_planting_date_moves_the_forecast_period(client):
    r = client.post(f"{API}/outlook", json={**WEST_IRBID, "planting_date": "2025-11-15"})
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["data_mode"] == "historical_data" and o["is_default_date"] is False
    assert o["planting_date"] == "2025-11-15" and o["forecast_origin"] == "2025-11-14"
    assert [(p["period_start"], p["period_end"]) for p in o["periods"]] == [("2025-11-15", "2025-12-14"), ("2025-11-15", "2026-02-12")]
    spring = client.post(f"{API}/outlook", json=WEST_IRBID).json()
    # mid-November is cooler than May
    assert o["periods"][0]["forecast"][0]["value"] < spring["periods"][0]["forecast"][0]["value"]
    # asking for the default date explicitly gives exactly the default answer
    same = client.post(f"{API}/outlook", json={**WEST_IRBID, "planting_date": "2026-05-02"}).json()
    assert same["periods"] == spring["periods"] and same["is_default_date"] is True


def test_planting_date_outside_the_data_is_refused(client):
    r = client.post(f"{API}/outlook", json={**IRBID, "planting_date": "2031-01-01"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "DATE_OUT_OF_RANGE"
    assert r.json()["error"]["details"]["default"] == "2026-05-02"
