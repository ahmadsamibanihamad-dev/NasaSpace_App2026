import pytest

from app.services.crops import CROP_IDS
from tests.conftest import API, auth_headers, make_farm, make_plot

STAGES = ["retrieving_environmental_data", "processing_satellite_information", "evaluating_crop_requirements", "generating_recommendations"]
META = ("data_sources", "data_quality", "confidence", "data_timestamp", "data_freshness", "analysis_basis", "is_demo", "model_version", "engine_fallback", "disclaimer")


def demo(client, h):
    farm = client.post(f"{API}/farms/demo", headers=h).json()
    return farm, client.get(f"{API}/farms/{farm['id']}/plots", headers=h).json()


def run(client, h, **body):
    r = client.post(f"{API}/analyses", json=body, headers=h)
    assert r.status_code == 202, r.text
    a = client.get(f"{API}/analyses/{r.json()['analysis_id']}", headers=h).json()  # background task already ran
    assert a["status"] == "completed", a["error"]
    assert [s["key"] for s in a["stages"]] == STAGES and all(s["status"] == "done" for s in a["stages"])
    for k in META:
        assert k in a["result"], k
    assert a["result"]["data_sources"] == ["NASA POWER"] and a["result"]["model_version"] == "rules-v1"
    return a


def test_crop_suitability_result_shape(client):
    h = auth_headers(client)
    farm, plots = demo(client, h)
    a = run(client, h, analysis_type="crop_suitability", farm_id=farm["id"], plot_ids=[plots[0]["id"], plots[5]["id"]], crop_id="wheat")
    res = a["result"]
    assert res["is_demo"] is True and res["analysis_basis"] == "historical_climatology"
    assert [p["plot_label"] for p in res["plots"]] == ["A1", "B3"]
    p = res["plots"][0]
    assert p["crop"] == "wheat" and 0 <= p["suitability_score"] <= 100
    assert p["suitability_status"] in ("highly_suitable", "suitable", "marginal", "unsuitable")
    assert set(p["environmental_scores"]) == {"temperature", "soil_moisture", "precipitation", "solar_radiation"}
    assert len(p["period_scores"]) == 36 and len(p["alternative_crops"]) == 3
    assert p["explanation"]["ar"] and p["explanation"]["en"] and str(p["suitability_score"]) in p["explanation"]["en"]
    assert any(e["metric"] == "seasonal_rainfall_mm" and e["source"] == "NASA POWER" for e in p["evidence"])
    for r in p["risks"]:
        assert r["severity"] in ("low", "moderate", "high") and r["explanation"]["ar"] and r["action"]["en"]
    # the irrigated parcel is not limited by rainfall, the rainfed one is
    assert res["plots"][1]["environmental_scores"]["precipitation"] >= 95 > p["environmental_scores"]["precipitation"]
    assert a["summary"]["headline_score"] == p["suitability_score"] and a["summary"]["plots"] == ["A1", "B3"]
    # the parcels list now carries the latest score
    listed = {x["label"]: x for x in client.get(f"{API}/farms/{farm['id']}/plots", headers=h).json()}
    assert listed["A1"]["latest_score"] == p["suitability_score"] and listed["A2"]["latest_score"] is None


def test_recommendation_calendar_water_risk(client):
    h = auth_headers(client)
    farm, plots = demo(client, h)
    rec = run(client, h, analysis_type="crop_recommendation", farm_id=farm["id"], plot_ids=None)["result"]["recommendations"]
    assert len(rec) == 6 and len(rec[0]["ranked"]) == 13
    scores = [c["suitability_score"] for c in rec[0]["ranked"]]
    assert scores == sorted(scores, reverse=True)
    assert all(c["water_demand"] in (1, 2, 3) and c["main_reason"]["ar"] and c["requirements"] for c in rec[0]["ranked"])

    cal = run(client, h, analysis_type="planting_window", farm_id=farm["id"])["result"]["calendar"]
    # no crop chosen: every crop is listed, once per distinct irrigation setting, best first
    assert len(cal["rows"]) % 13 == 0 and {r["crop"] for r in cal["rows"]} == set(CROP_IDS)
    first = [r for r in cal["rows"] if r["plot_id"] == cal["rows"][0]["plot_id"]]
    assert len(first) == 13 and all(len(r["period_scores"]) == 36 for r in first)
    assert len(cal["frost_periods"]) == 36 and len(cal["monthly_rainfall_mm"]) == 12
    # a chosen crop: one row per parcel
    one = run(client, h, analysis_type="planting_window", farm_id=farm["id"], crop_id="wheat")["result"]["calendar"]
    assert len(one["rows"]) == 6 and {r["crop"] for r in one["rows"]} == {"wheat"}

    water = run(client, h, analysis_type="water", farm_id=farm["id"], plot_ids=[plots[5]["id"]])["result"]["water"][0]
    assert water["crop"] == "tomato" and water["season_total"]["irrigation_m3"] > 0
    assert sum(m["etc_mm"] for m in water["monthly"]) == pytest.approx(water["season_total"]["etc_mm"], abs=1)

    risk = run(client, h, analysis_type="risk", farm_id=farm["id"])["result"]
    assert risk["risks"] and all(r["affected_plots"] for r in risk["risks"])
    assert {p["plot_label"] for p in risk["plots"]} == {"A1", "A2", "A3", "B1", "B2", "B3"}


def test_rotation_has_three_strategies_with_five_sections(client):
    h = auth_headers(client)
    farm, plots = demo(client, h)
    out = run(client, h, analysis_type="rotation", farm_id=farm["id"], plot_ids=[plots[0]["id"]], priority="save_water")["result"]["rotation"][0]
    assert [s["key"] for s in out["strategies"]] == ["current", "option_a", "option_b"]
    assert len(out["history"]) == 3
    for s in out["strategies"]:
        assert len(s["sequence"]) == 3
        for section in ("why", "evidence", "benefits", "information_gaps", "risks_for_review"):
            assert s[section], (s["key"], section)
        assert set(s["scores"]) == {"water_use", "soil_health", "income_potential"}


def test_history_is_kept_per_user_and_can_be_deleted(client):
    h = auth_headers(client)
    farm, _ = demo(client, h)
    a = run(client, h, analysis_type="risk", farm_id=farm["id"])
    run(client, h, analysis_type="crop_recommendation", farm_id=farm["id"])
    rows = client.get(f"{API}/analyses", params={"farm_id": farm["id"]}, headers=h).json()
    assert len(rows) == 2 and all(r["result"] is None for r in rows)  # the list is light; details come one by one
    assert len(client.get(f"{API}/analyses", params={"farm_id": farm["id"], "analysis_type": "risk"}, headers=h).json()) == 1
    h2 = auth_headers(client, "other@example.com")
    assert client.get(f"{API}/analyses/{a['id']}", headers=h2).status_code == 404
    assert client.get(f"{API}/analyses", params={"farm_id": farm["id"]}, headers=h2).status_code == 404
    assert client.delete(f"{API}/analyses/{a['id']}", headers=h).status_code == 204
    assert len(client.get(f"{API}/analyses", params={"farm_id": farm["id"]}, headers=h).json()) == 1


def test_analysis_validation(client):
    h = auth_headers(client)
    farm = make_farm(client, h)
    r = client.post(f"{API}/analyses", json={"analysis_type": "risk", "farm_id": farm["id"]}, headers=h)
    assert r.status_code == 422  # no parcels yet
    p = make_plot(client, h, farm["id"], "1")
    r = client.post(f"{API}/analyses", json={"analysis_type": "crop_suitability", "farm_id": farm["id"]}, headers=h)
    assert r.status_code == 422  # crop required
    r = client.post(f"{API}/analyses", json={"analysis_type": "crop_suitability", "farm_id": farm["id"], "crop_id": "banana"}, headers=h)
    assert r.json()["error"]["code"] == "UNSUPPORTED_CROP"
    r = client.post(f"{API}/analyses", json={"analysis_type": "risk", "farm_id": farm["id"], "plot_ids": ["nope"]}, headers=h)
    assert r.status_code == 422
    assert p["latest_score"] is None


def test_guest_gets_recommendations_and_nothing_is_saved(client):
    r = client.post(f"{API}/guest/recommendations", json={"lat": 32.5568, "lon": 35.8469})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["saved"] is False and out["location"]["governorate"]["id"] == "ir"
    assert 1 <= len(out["recommended_crops"]) <= 6 and len(out["all_crops"]) == 13
    top = out["recommended_crops"][0]
    assert top["main_reason"]["ar"] and top["suitability_status"] and "requirements" not in top
    assert out["data_sources"] == ["NASA POWER"] and out["disclaimer"]["ar"]
    # irrigation changes the answer
    wet = client.post(f"{API}/guest/recommendations", json={"lat": 32.5568, "lon": 35.8469, "irrigation_available": True, "irrigation_method": "drip"}).json()
    assert wet["recommended_crops"][0]["suitability_score"] >= top["suitability_score"]
    # outside Jordan is refused clearly
    bad = client.post(f"{API}/guest/recommendations", json={"lat": 33.51, "lon": 36.29})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "UNSUPPORTED_LOCATION"
    # no rows of any kind were written for the guest
    from sqlmodel import Session, select

    from app.core.db import get_engine
    from app.models import Analysis, Farm, Forecast, Plot, User

    with Session(get_engine()) as s:
        for model in (User, Farm, Plot, Analysis, Forecast):
            assert s.exec(select(model)).all() == [], model.__name__


def test_environment_and_crops(client):
    h = auth_headers(client)
    summ = client.get(f"{API}/environment/summary", params={"lat": 32.5568, "lon": 35.8469}, headers=h).json()
    assert set(summ["metrics"]) == {"soil_moisture", "temperature", "seasonal_rainfall"}
    assert len(summ["metrics"]["temperature"]["trend"]) == 12 and "is_stale" in summ["data_freshness"]
    for res, n in (("daily", 365), ("monthly", 24), ("seasonal", 12)):
        ts = client.get(f"{API}/environment/timeseries", params={"lat": 32.5568, "lon": 35.8469, "variable": "rainfall", "resolution": res}, headers=h).json()
        assert len(ts["points"]) == n and ts["unit"] == "mm", res
    assert client.get(f"{API}/environment/summary", params={"lat": 33.51, "lon": 36.29}, headers=h).json()["error"]["code"] == "UNSUPPORTED_LOCATION"
    crops = client.get(f"{API}/crops").json()
    assert len(crops) == 13 and all(c["temp"]["opt_min"]["source"] for c in crops)
    assert client.get(f"{API}/crops/wheat").json()["kc"]["mid"]["source"].startswith("FAO-56")
    assert client.get(f"{API}/crops/banana").status_code == 404


def test_forecasts_disabled_mock_and_production(client, monkeypatch, tmp_path):
    from app.ml import service
    from app.ml.mock import MockPredictionService

    h = auth_headers(client)
    body = {"lat": 32.5568, "lon": 35.8469, "forecast_type": "rolling", "forecast_horizon_days": 7}
    # AI_MODE=off: explicit status, no invented numbers
    off = client.post(f"{API}/forecasts", json=body, headers=h)
    assert off.status_code == 503 and off.json()["error"]["code"] == "FORECAST_DISABLED"
    assert client.get(f"{API}/models/status").json() == {**client.get(f"{API}/models/status").json(), "ai_mode": "off", "ready": False}

    # mock: same shape as the final contract, clearly labelled
    service.set_prediction_service(MockPredictionService())
    r = client.post(f"{API}/forecasts", json=body, headers=h)
    assert r.status_code == 201, r.text
    f = r.json()
    assert f["data_mode"] == "mock" and "mock" in f["warnings"][0].lower() and f["schema_version"] == "1.0"
    assert len(f["daily_predictions"]) == 7 and f["forecast"]["model_version"] is None and f["prediction_intervals"] is None
    assert set(f["summary"]) == {"average_temperature_c", "average_relative_humidity_percent", "average_soil_moisture_m3_m3", "total_precipitation_mm"}
    assert f["crop_outlook"]["data_mode"] == "mock" and len(f["crop_outlook"]["crops"]) == 13
    # 90 days and seasons are aggregates: no fabricated daily values
    agg = client.post(f"{API}/forecasts", json={**body, "forecast_horizon_days": 90}, headers=h).json()
    assert agg["daily_predictions"] == [] and agg["summary"]["average_temperature_c"] is not None
    season = client.post(f"{API}/forecasts", json={"lat": 32.5568, "lon": 35.8469, "forecast_type": "calendar_season", "season": "winter", "season_year": 2027}, headers=h).json()
    assert (season["forecast"]["start_date"], season["forecast"]["end_date"]) == ("2026-12-01", "2027-02-28") and season["daily_predictions"] == []
    assert client.post(f"{API}/forecasts", json={"lat": 32.5568, "lon": 35.8469, "forecast_type": "calendar_season"}, headers=h).status_code == 422
    hist = client.get(f"{API}/forecasts/history", headers=h).json()
    assert len(hist) == 3 and client.get(f"{API}/forecasts/{hist[0]['forecast_id']}", headers=h).status_code == 200
    h2 = auth_headers(client, "other@example.com")
    assert client.get(f"{API}/forecasts/{hist[0]['forecast_id']}", headers=h2).status_code == 404

    # production without delivered models: explicit unavailable, never a silent fall back to mock
    from app.core.config import get_settings
    from app.ml.production import ProductionPredictionService

    monkeypatch.setattr(get_settings(), "model_dir", str(tmp_path))
    service.set_prediction_service(ProductionPredictionService())
    prod = client.post(f"{API}/forecasts", json=body, headers=h)
    assert prod.status_code == 503 and prod.json()["error"]["code"] == "MODEL_UNAVAILABLE"
    assert set(prod.json()["error"]["details"]["missing_targets"]) == {"T2M", "RH2M", "SFMC", "IMERG_PRECTOT"}
    st = client.get(f"{API}/models/status").json()
    assert st["ai_mode"] == "production" and st["ready"] is False and st["models"] == []


def test_model_registry_reads_manifests(tmp_path):
    import json

    from app.ml.production import load_registry

    (tmp_path / "manifests").mkdir()
    good = {"model_id": "t2m-7d", "model_version": "1", "algorithm": "xgboost", "target": "T2M", "forecast_type": "rolling", "horizon_days": 7, "feature_names": ["a", "b"], "artifact_path": "x.json", "deployment_status": "deployed"}
    (tmp_path / "manifests" / "a.json").write_text(json.dumps(good))
    (tmp_path / "manifests" / "broken.json").write_text("{not json")
    entries, problems = load_registry(tmp_path)
    assert [e.model_id for e in entries] == ["t2m-7d"] and entries[0].feature_names == ["a", "b"]
    assert len(problems) == 1 and "broken.json" in problems[0]
