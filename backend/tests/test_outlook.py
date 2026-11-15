"""Forecast outlook: the AI team's package (backend/nasa_final) behind /api/v1/outlook."""

import pytest
from sqlmodel import Session, select

from app.core import db
from app.models import Analysis, Forecast

from .conftest import API

pytest.importorskip("pandas")
pytest.importorskip("pyarrow")
pytest.importorskip("xgboost")

IRBID = {"lat": 32.5568, "lon": 35.8469}


def test_status_reports_the_demo_snapshot(client):
    s = client.get(f"{API}/outlook/status").json()
    assert s["available"] is True and s["data_mode"] == "historical_demo"
    assert s["forecast_origin"] == "2026-05-01" and s["horizons_days"] == [30, 90]
    assert len(s["crops"]) == 6 and {c["horizon_days"] for c in s["crops"]} == {30, 90}


def test_outlook_gives_two_periods_with_three_ranked_crops(client):
    r = client.post(f"{API}/outlook", json={**IRBID, "irrigation_available": True})
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["data_mode"] == "historical_demo" and o["saved"] is False
    assert o["location"]["governorate"]["id"] == "ir" and o["grid"]["distance_km"] < 15
    assert [p["horizon_days"] for p in o["periods"]] == [30, 90]
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


def test_outlook_stores_nothing(client):
    client.post(f"{API}/outlook", json=IRBID)
    with Session(db.get_engine()) as s:
        assert s.exec(select(Forecast)).first() is None and s.exec(select(Analysis)).first() is None


def test_irrigation_changes_the_water_factor(client):
    dry = client.post(f"{API}/outlook", json={**IRBID, "irrigation_available": False}).json()
    wet = client.post(f"{API}/outlook", json={**IRBID, "irrigation_available": True}).json()
    d, w = dry["periods"][1]["recommendations"][0], wet["periods"][1]["recommendations"][0]
    assert w["factor_scores"]["rainfall_proxy"] == 100 and d["factor_scores"]["rainfall_proxy"] < 100


def test_soil_ph_is_used_when_given_and_never_invented(client):
    given = client.post(f"{API}/outlook", json={**IRBID, "soil_ph": 6.8}).json()
    assert given["soil_ph"] == {"value": 6.8, "source": "user"}
    assert "soil_ph" in given["periods"][0]["recommendations"][0]["factor_scores"]
    # without a value the static soil table is used where it has data, otherwise pH is left out
    auto = client.post(f"{API}/outlook", json={"lat": 31.95, "lon": 35.93}).json()
    if auto["soil_ph"] is None:
        assert "soil_ph" not in auto["periods"][0]["recommendations"][0]["factor_scores"]
    else:
        assert auto["soil_ph"]["source"] == "soilgrids" and 3 < auto["soil_ph"]["value"] < 11


def test_outside_jordan_is_refused(client):
    r = client.post(f"{API}/outlook", json={"lat": 30.0, "lon": 30.0})
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNSUPPORTED_LOCATION"
