"""Crop Rotation Planner: the planning logic (nasa_final/AI/crop_rotation.py) and its API.

Forecast values written out in this file are explicit unit-test fixtures. The API tests further
down use the real saved forecasting artifacts.
"""

from datetime import date

import pytest

from .conftest import API, auth_headers, make_farm

pytest.importorskip("pandas")
pytest.importorskip("pyarrow")
pytest.importorskip("xgboost")

from nasa_final.AI import crop_rotation as cr  # noqa: E402
from nasa_final.AI.recommendation_system import recommend  # noqa: E402

# ---- unit-test fixtures (not forecasts) ----
COOL_30 = dict(temperature_c=16.0, humidity_pct=68.0, soil_moisture_m3_m3=0.20, rainfall_mm=36.0)
COOL_90 = dict(temperature_c=17.0, humidity_pct=66.0, soil_moisture_m3_m3=0.22, rainfall_mm=150.0)
WEST_IRBID = {"latitude": 32.551, "longitude": 35.752}


def seq(rotation):
    return [s["crop_id"] for s in rotation["sequence"]]


# ---------------- derived second phase ----------------


def test_phase_2_means_and_rain_total_are_derived_correctly():
    v, problems = cr.derive_phase_2(COOL_30, COOL_90)
    assert problems == []
    assert v["temperature_c"] == pytest.approx((90 * 17.0 - 30 * 16.0) / 60)  # 17.5, not the 90-day mean
    assert v["humidity_pct"] == pytest.approx(65.0)
    assert v["soil_moisture_m3_m3"] == pytest.approx(0.23)
    assert v["rainfall_mm"] == pytest.approx(114.0)  # total, by subtraction


def test_inconsistent_forecasts_are_reported_and_never_clipped():
    v, problems = cr.derive_phase_2(COOL_30, dict(COOL_90, rainfall_mm=10.0))
    assert v["rainfall_mm"] == pytest.approx(-26.0)  # kept as computed
    assert [p["variable"] for p in problems] == ["rainfall_mm"] and problems[0]["message"]["ar"]
    _, p2 = cr.derive_phase_2(dict(COOL_30, humidity_pct=95.0), dict(COOL_90, humidity_pct=20.0))
    assert "humidity_pct" in [p["variable"] for p in p2]

    out = cr.plan(COOL_30, dict(COOL_90, rainfall_mm=10.0), irrigation_available=True)
    assert out["status"] == "partial_plan" and out["forecasts"]["phase_2"]["reliable"] is False
    assert len(out["best_rotation"]["sequence"]) == 1  # a first crop only; no second crop is invented
    assert any("inconsistent" in w["en"] for w in out["warnings"])


# ---------------- families ----------------


def test_same_family_sequences_are_penalised():
    out = cr.plan(COOL_30, COOL_90, previous_crop="wheat", irrigation_available=True, soil_ph=7.0)
    ranked = {tuple(seq(r)): r for r in [out["best_rotation"], *out["alternative_rotations"]]}
    all_pairs = {}
    # score every sequence, not only the top three
    for first in cr.SHORT_TERM:
        recs_2 = cr.evaluate_phase(90, 60, out["forecasts"]["phase_2"], True, 7.0, history=[{"crop_id": first, "years_ago": 1}, {"crop_id": "wheat", "years_ago": 2}])
        for second, r in recs_2.items():
            all_pairs[(first, second)] = r["rotation"]["score"]
    assert all_pairs[("spinach", "beet")] < all_pairs[("radish", "beet")]  # spinach and beet are both Amaranthaceae
    assert all_pairs[("radish", "carrot")] == 100  # different families
    assert all(r["components"]["family_diversity_score"] is not None for r in ranked.values())
    # the engine explains the repeat on the second crop
    recs = cr.evaluate_phase(90, 60, out["forecasts"]["phase_2"], True, 7.0, history=[{"crop_id": "spinach", "years_ago": 1}])
    assert any("same family" in n["en"] for n in recs["beet"]["explanations"])


def test_previous_crop_changes_the_ranking():
    fresh = cr.plan(COOL_30, COOL_90, irrigation_available=True, soil_ph=7.0)
    after_radish = cr.plan(COOL_30, COOL_90, previous_crop="radish", irrigation_available=True, soil_ph=7.0)
    after_wheat = cr.plan(COOL_30, COOL_90, previous_crop="wheat", irrigation_available=True, soil_ph=7.0)  # not one of the six candidates
    assert seq(after_radish["best_rotation"])[0] == "spinach"  # the only short crop outside the cabbage family
    assert seq(after_radish["best_rotation"]) != seq(cr.plan(COOL_30, COOL_90, previous_crop="spinach", irrigation_available=True, soil_ph=7.0)["best_rotation"])
    assert after_wheat["previous_crop"] == "wheat" and after_wheat["crop_history"] == [{"crop_id": "wheat", "years_ago": 1, "family": "Poaceae"}]
    first = after_radish["best_rotation"]["sequence"][0]
    assert first["rotation"]["evaluated"] is True and any("different botanical family" in r["en"].lower() for r in first["reasons"])
    assert any("previous crop is unknown" in w["en"] for w in fresh["warnings"])
    assert not any("previous crop is unknown" in w["en"] for w in after_radish["warnings"])
    # the second crop is always judged against the first one
    assert all(r["sequence"][1]["rotation"]["evaluated"] for r in [fresh["best_rotation"], *fresh["alternative_rotations"]])


def test_a_different_family_alone_does_not_make_a_crop_recommended():
    # too hot for every crop: no sequence, however diverse
    hot = cr.plan(dict(COOL_30, temperature_c=40.0), dict(COOL_90, temperature_c=40.0), irrigation_available=True)
    assert hot["status"] == "no_plan_available" and hot["best_rotation"] is None and hot["alternative_rotations"] == []
    assert hot["explanation"] and {r["reason"] for r in hot["rejected"]} == {"environment"}


# ---------------- duration ----------------


def test_duration_compatibility():
    crops = cr.CROPS
    assert cr.duration_fit(crops["radish"], 30) == {"fits": True, "conditional": False, "score": 100.0}  # 20-30 days
    fit = cr.duration_fit(crops["arugula"], 30)  # 25-45 days: only with an early cultivar
    assert fit["fits"] and fit["conditional"] and 0 < fit["score"] < 100
    assert cr.duration_fit(crops["beet"], 60)["conditional"] is False  # 50-60 days
    assert cr.duration_fit(crops["carrot"], 60)["conditional"] is True  # 55-88 days
    assert cr.duration_fit(crops["carrot"], 50)["fits"] is False  # cannot fit at all


def test_early_cultivar_sequences_are_conditional():
    out = cr.plan(COOL_30, COOL_90, irrigation_available=True, soil_ph=7.0)
    for r in [out["best_rotation"], *out["alternative_rotations"]]:
        early = [s for s in r["sequence"] if s["requires_early_cultivar"]]
        if early:
            assert r["status"] == "conditionally_suitable"
            assert all(any("early-maturing" in c["en"] for c in s["conditions"]) for s in early)
        for s in r["sequence"]:
            assert s["earliest_harvest_day"] == s["planting_day"] + s["growth_days"][0] - 1


# ---------------- scoring ----------------


def test_rotation_score_follows_the_documented_weights():
    out = cr.plan(COOL_30, COOL_90, irrigation_available=True, soil_ph=7.0)
    assert out["status"] == "success" and out["weights"] == cr.WEIGHTS and sum(cr.WEIGHTS.values()) == pytest.approx(1.0)
    ranked = [out["best_rotation"], *out["alternative_rotations"]]
    assert len(ranked) == 3 and [r["rotation_score"] for r in ranked] == sorted((r["rotation_score"] for r in ranked), reverse=True)
    for r in ranked:
        c = r["components"]
        expected = 0.40 * c["first_crop_suitability"] + 0.40 * c["second_crop_suitability"] + 0.15 * c["family_diversity_score"] + 0.05 * c["duration_compatibility_score"]
        assert r["rotation_score"] == pytest.approx(expected, abs=0.06)
        assert all(0 <= v <= 100 for v in c.values())
        assert [s["phase"] for s in r["sequence"]] == [1, 2] and [s["planting_day"] for s in r["sequence"]] == [1, 31]
        assert seq(r)[0] in cr.SHORT_TERM and seq(r)[1] in cr.LONG_TERM


def test_crop_scores_come_from_the_existing_recommendation_engine():
    out = cr.plan(COOL_30, COOL_90, irrigation_available=True, soil_ph=7.0)
    engine = {r["crop_id"]: r["score"] for r in recommend(30, **COOL_30, irrigation_available=True, soil_ph=7.0)["recommendations"]}
    first = out["best_rotation"]["sequence"][0]
    assert first["suitability_score"] == engine[first["crop_id"]]


def test_missing_soil_and_unknown_irrigation_are_said_not_guessed():
    out = cr.plan(COOL_30, COOL_90)
    text = " ".join(w["en"] for w in out["warnings"])
    assert "Soil data is not available" in text and "Irrigation availability is unknown" in text
    first = out["best_rotation"]["sequence"][0]
    assert first["component_scores"]["soil_ph"] is None and first["component_scores"]["fertility"] is None and first["coverage_pct"] < 100


def test_thirty_day_horizon_gives_a_single_crop():
    out = cr.plan(COOL_30, None, planning_horizon_days=30, irrigation_available=True)
    assert out["status"] == "success" and "phase_2" not in out["forecasts"]
    assert len(out["best_rotation"]["sequence"]) == 1 and seq(out["best_rotation"])[0] in cr.SHORT_TERM
    with pytest.raises(ValueError):
        cr.plan(COOL_30, COOL_90, planning_horizon_days=60)
    with pytest.raises(ValueError):
        cr.plan(COOL_30, COOL_90, previous_crop="mango")


# ---------------- API, with the real saved forecasting artifacts ----------------


def test_api_plan_with_real_forecasts(client):
    r = client.post(f"{API}/crop-rotation/plan", json={**WEST_IRBID, "planning_horizon_days": 90, "previous_crop": "radish", "irrigation_available": True, "cultivation_type": "open_field"})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["status"] in {"success", "partial_plan", "no_plan_available"} and p["saved"] is False
    assert p["data_mode"] == "historical_demo" and p["forecast_origin"] == "2026-05-01" and p["planting_date"] == "2026-05-02"
    assert p["location"]["grid_id"].startswith("JOR_") and p["location"]["governorate"]["id"] == "ir"
    ph1, ph2 = p["forecasts"]["phase_1"], p["forecasts"]["phase_2"]
    assert (ph1["start_day"], ph1["end_day"], ph1["start_date"], ph1["end_date"]) == (1, 30, "2026-05-02", "2026-05-31")
    assert (ph2["start_day"], ph2["end_day"], ph2["start_date"], ph2["end_date"]) == (31, 90, "2026-06-01", "2026-07-30")
    assert ph2["method"] == "derived_from_30_and_90_day_forecasts"
    # phase 2 really is derived from the two forecasts the outlook shows
    o = client.post(f"{API}/outlook", json={"lat": WEST_IRBID["latitude"], "lon": WEST_IRBID["longitude"], "irrigation_available": True}).json()
    f30 = {f["key"]: f["value"] for f in o["periods"][0]["forecast"]}
    f90 = {f["key"]: f["value"] for f in o["periods"][1]["forecast"]}
    assert ph1["temperature_c"] == f30["temperature_c"]
    assert ph2["temperature_c"] == pytest.approx((90 * f90["temperature_c"] - 30 * f30["temperature_c"]) / 60)
    assert ph2["rainfall_mm"] == pytest.approx(f90["rainfall_mm"] - f30["rainfall_mm"])
    assert any("Historical data mode" in w["en"] for w in p["warnings"]) and all(w["ar"] and w["en"] for w in p["warnings"])
    if p["best_rotation"]:
        for s in p["best_rotation"]["sequence"]:
            assert s["planting_date"] and s["earliest_harvest_date"] <= s["latest_harvest_date"]
            assert all(t["ar"] and t["en"] for t in s["reasons"] + s["conditions"])


def test_api_validation(client):
    bad = [
        {**WEST_IRBID, "planning_horizon_days": 60},
        {**WEST_IRBID, "cultivation_type": "hydroponic"},
        {"latitude": 200, "longitude": 35.7},
        {"longitude": 35.7},
    ]
    for body in bad:
        r = client.post(f"{API}/crop-rotation/plan", json=body)
        assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR", body
    unknown = client.post(f"{API}/crop-rotation/plan", json={**WEST_IRBID, "previous_crop": "mango"})
    assert unknown.status_code == 422 and unknown.json()["error"]["code"] == "UNSUPPORTED_CROP"
    ok = client.post(f"{API}/crop-rotation/plan", json={**WEST_IRBID, "previous_crop": "wheat", "previous_crop_year": 2025, "crop_history": [{"year": 2024, "crop_id": "tomato"}]})
    assert ok.status_code == 200 and [(h["crop_id"], h["years_ago"]) for h in ok.json()["crop_history"]] == [("wheat", 1), ("tomato", 2)]
    out = client.post(f"{API}/crop-rotation/plan", json={"latitude": 30.0, "longitude": 30.0})
    assert out.status_code == 422 and out.json()["error"]["code"] == "UNSUPPORTED_LOCATION"
    # a planting date the data does not cover is refused, never served from other dates
    late = client.post(f"{API}/crop-rotation/plan", json={**WEST_IRBID, "planting_date": str(date(2031, 1, 1))})
    assert late.status_code == 422 and late.json()["error"]["code"] == "DATE_OUT_OF_RANGE"
    single = client.post(f"{API}/crop-rotation/plan", json={**WEST_IRBID, "planning_horizon_days": 30}).json()
    assert "phase_2" not in single["forecasts"] and single["previous_crop"] is None


def test_saved_plans_belong_to_their_user(client):
    h = auth_headers(client)
    farm = make_farm(client, h)
    body = {**WEST_IRBID, "farm_id": farm["id"], "previous_crop": "spinach", "irrigation_available": True}
    assert client.post(f"{API}/crop-rotation/plans", json=body).status_code == 401  # guests cannot save
    r = client.post(f"{API}/crop-rotation/plans", json=body, headers=h)
    assert r.status_code == 201, r.text
    saved = r.json()
    assert saved["plan"]["saved"] is True and saved["summary"]["planting_date"] == "2026-05-02"
    listed = client.get(f"{API}/crop-rotation/plans", params={"farm_id": farm["id"]}, headers=h).json()
    assert [x["id"] for x in listed] == [saved["id"]] and "plan" not in listed[0]
    assert client.get(f"{API}/crop-rotation/plans/{saved['id']}", headers=h).json()["plan"]["previous_crop"] == "spinach"
    h2 = auth_headers(client, "other@example.com")
    assert client.get(f"{API}/crop-rotation/plans/{saved['id']}", headers=h2).status_code == 404
    assert client.get(f"{API}/crop-rotation/plans", params={"farm_id": farm["id"]}, headers=h2).status_code == 404
    assert client.delete(f"{API}/crop-rotation/plans/{saved['id']}", headers=h2).status_code == 404
    # deleting the farm removes its saved plans too
    again = client.post(f"{API}/crop-rotation/plans", json=body, headers=h).json()
    assert client.delete(f"{API}/farms/{farm['id']}", headers=h).status_code == 204
    assert client.get(f"{API}/crop-rotation/plans/{again['id']}", headers=h).status_code == 404
