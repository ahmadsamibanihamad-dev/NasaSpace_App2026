"""Multi-factor recommendation engine (nasa_final/AI/recommendation_system.py, rule version mvp-2).

Site dicts and forecast numbers written out in this file are explicit unit-test fixtures. The API
tests in test_outlook.py use the real dataset and saved models.
"""

import copy

import pytest

pytest.importorskip("pandas")
pytest.importorskip("pyarrow")

from nasa_final.AI import environment_service as env  # noqa: E402
from nasa_final.AI import recommendation_system as rs  # noqa: E402

MILD = dict(temperature_c=16.0, humidity_pct=65.0, soil_moisture_m3_m3=0.22, rainfall_mm=40.0)
WARM = dict(temperature_c=19.0, humidity_pct=60.0, soil_moisture_m3_m3=0.22, rainfall_mm=150.0)


def fixture_site(sand, silt, clay, *, ph=7.0, fertility=60.0, slope_pct=1.0, coarse=5.0, history=None):
    """A site dict shaped like environment_service.site_context, with chosen values (test fixture, not data)."""
    values = lambda: {  # noqa: E731
        "ph": {"value": ph, "unit": "pH", "source": "fixture"},
        "sand": {"value": sand, "unit": "%", "source": "fixture"},
        "silt": {"value": silt, "unit": "%", "source": "fixture"},
        "clay": {"value": clay, "unit": "%", "source": "fixture"},
        "organic_carbon": {"value": 6.0, "unit": "g/kg", "source": "fixture"},
        "nitrogen": {"value": 0.7, "unit": "g/kg", "source": "fixture"},
        "cec": {"value": 15.0, "unit": "cmol/kg", "source": "fixture"},
        "bulk_density": {"value": 1.4, "unit": "kg/dm3", "source": "fixture"},
        "coarse_fragments": {"value": coarse, "unit": "%", "source": "fixture"},
    }
    cls = env.texture_class(sand, silt, clay)
    rank = {"organic_carbon": fertility, "nitrogen": fertility, "cec": fertility}
    return {
        "grid_id": "FIXTURE",
        "soil": {"kind": "static_property", "layers": [], "by_depth": {"0-30": values(), "0-60": values()}, "texture_class": {"0-30": cls, "0-60": cls}, "fertility_percentile": {"0-30": dict(rank), "0-60": dict(rank)}, "has_data": True},
        "terrain": {"kind": "static_property", "elevation_m": 800.0, "slope_deg": 0.6, "slope_pct": slope_pct, "aspect_deg": 180.0},
        "history": history,
    }


SANDY = fixture_site(70, 20, 10)  # sandy loam: light
CLAY = fixture_site(15, 30, 55)  # clay: heavy


def ranking(result):
    return [r["crop_id"] for r in result["recommendations"]]


def by_id(result):
    return {r["crop_id"]: r for r in result["recommendations"]}


# 1 ------------------------------------------------------------------


def test_same_temperature_different_soil_texture_changes_the_recommendation():
    assert env.texture_class(70, 20, 10) == "sandy loam" and env.texture_class(15, 30, 55) == "clay"
    light = rs.recommend(30, **MILD, irrigation_available=True, site=SANDY)
    heavy = rs.recommend(30, **MILD, irrigation_available=True, site=CLAY)
    # identical forecast: temperature component is the same for every crop in both runs
    assert {r["component_scores"]["temperature"] for r in light["recommendations"]} == {100.0}
    assert {r["component_scores"]["temperature"] for r in heavy["recommendations"]} == {100.0}
    assert ranking(light)[0] == "radish"  # root crop prefers light, sandy soil
    assert ranking(heavy)[0] != "radish" and ranking(heavy)[-1] == "radish"  # heavy soil needs amendment for it
    assert by_id(light)["radish"]["component_scores"]["texture_drainage"] > by_id(heavy)["radish"]["component_scores"]["texture_drainage"]
    assert by_id(heavy)["spinach"]["component_scores"]["texture_drainage"] > by_id(heavy)["radish"]["component_scores"]["texture_drainage"]


def test_stones_lower_root_crops_only():
    stony = fixture_site(70, 20, 10, coarse=40.0)
    a, b = by_id(rs.recommend(90, **WARM, irrigation_available=True, site=SANDY)), by_id(rs.recommend(90, **WARM, irrigation_available=True, site=stony))
    assert b["carrot"]["component_scores"]["texture_drainage"] < a["carrot"]["component_scores"]["texture_drainage"]
    assert b["bush_bean"]["component_scores"]["texture_drainage"] == a["bush_bean"]["component_scores"]["texture_drainage"]


# 2 ------------------------------------------------------------------


def test_same_conditions_different_previous_crop_changes_the_ranking():
    after_radish = rs.recommend(30, **MILD, irrigation_available=True, site=CLAY, previous_crop="radish")
    after_spinach = rs.recommend(30, **MILD, irrigation_available=True, site=CLAY, previous_crop="spinach")
    assert ranking(after_radish) != ranking(after_spinach)
    assert ranking(after_radish)[0] == "spinach"  # the only candidate not in the cabbage family
    assert ranking(after_spinach)[0] == "arugula"
    # a previous crop outside the six candidates is accepted and has a family
    after_cabbage = rs.recommend(30, **MILD, irrigation_available=True, site=CLAY, previous_crop="cabbage")
    assert after_cabbage["previous_crops"] == [{"crop_id": "cabbage", "years_ago": 1, "family": "Brassicaceae"}]
    assert ranking(after_cabbage)[0] == "spinach"


# 3 ------------------------------------------------------------------


def test_repeating_a_family_reduces_rotation_compatibility():
    crops = rs.CROPS
    fresh, _, _ = rs.rotation_compatibility(crops["arugula"], [{"crop_id": "wheat", "years_ago": 1}])
    same_family, notes, detail = rs.rotation_compatibility(crops["arugula"], [{"crop_id": "radish", "years_ago": 1}])  # both Brassicaceae
    same_crop, _, _ = rs.rotation_compatibility(crops["arugula"], [{"crop_id": "arugula", "years_ago": 1}])
    assert fresh == 100 and same_crop < same_family < fresh
    assert detail["penalties"][0]["kind"] == "same_family" and any("same family" in n["en"] for n in notes)
    beet_after_spinach, _, _ = rs.rotation_compatibility(crops["beet"], [{"crop_id": "spinach", "years_ago": 1}])  # both Amaranthaceae
    beet_after_radish, _, _ = rs.rotation_compatibility(crops["beet"], [{"crop_id": "radish", "years_ago": 1}])
    assert beet_after_spinach < beet_after_radish
    # older seasons count less
    two_ago, _, _ = rs.rotation_compatibility(crops["arugula"], [{"crop_id": "wheat", "years_ago": 1}, {"crop_id": "radish", "years_ago": 2}])
    assert same_family < two_ago < fresh
    # a previous legume is a qualitative benefit and never a nitrogen promise
    carrot_after_bean, notes, _ = rs.rotation_compatibility(crops["carrot"], [{"crop_id": "bush_bean", "years_ago": 1}])
    assert carrot_after_bean == 100 and any("no increase in soil nitrogen is guaranteed" in n["en"] for n in notes)
    # two heavy feeders in a row
    spinach_after_arugula, notes, _ = rs.rotation_compatibility(crops["spinach"], [{"crop_id": "arugula", "years_ago": 1}])
    assert spinach_after_arugula < 100 and any("high-demand" in n["en"] for n in notes)


def test_unknown_previous_crop_is_reported_not_assumed():
    unknown = rs.recommend(30, **MILD, irrigation_available=True, site=CLAY)
    r = unknown["recommendations"][0]
    assert r["component_scores"]["rotation"] is None and "rotation" in r["missing_factors"] and r["rotation"]["evaluated"] is False
    assert r["coverage_pct"] == 80.0  # rotation carries 20 of 100
    assert any(n["component"] == "rotation" and n["effect"] == "unknown" for n in r["explanations"])
    other = rs.recommend(30, **MILD, irrigation_available=True, site=CLAY, previous_crop="other")
    assert other["recommendations"][0]["component_scores"]["rotation"] is None
    with pytest.raises(ValueError):
        rs.recommend(30, **MILD, previous_crop="mango")


# 4 ------------------------------------------------------------------


def test_changing_soil_moisture_changes_suitability():
    wet = by_id(rs.recommend(30, **MILD, irrigation_available=False, site=CLAY))
    dry = by_id(rs.recommend(30, **{**MILD, "soil_moisture_m3_m3": 0.04}, irrigation_available=False, site=CLAY))
    assert dry["spinach"]["component_scores"]["water"] < wet["spinach"]["component_scores"]["water"]
    assert dry["spinach"]["score"] < wet["spinach"]["score"]
    # very dry soil, no irrigation and little rain is a critical failure
    parched = rs.recommend(30, **{**MILD, "soil_moisture_m3_m3": 0.02, "rainfall_mm": 3.0}, irrigation_available=False, site=CLAY)
    assert parched["status"] == "no_suitable_recommendation" and parched["best_candidate"] is None
    assert all(r["status"] == "not_recommended" and r["critical_failures"] for r in parched["recommendations"])


def test_deep_rooted_crops_use_observed_root_zone_moisture():
    dry_roots = fixture_site(70, 20, 10, history={"root_zone_moisture_m3_m3": 0.05, "frost_frequency": 0.0, "t2m_max_mean_c": 20.0})
    wet_roots = fixture_site(70, 20, 10, history={"root_zone_moisture_m3_m3": 0.25, "frost_frequency": 0.0, "t2m_max_mean_c": 20.0})
    a, b = by_id(rs.recommend(90, **WARM, irrigation_available=False, site=dry_roots)), by_id(rs.recommend(90, **WARM, irrigation_available=False, site=wet_roots))
    assert a["carrot"]["component_scores"]["water"] < b["carrot"]["component_scores"]["water"]  # deep-rooted
    assert a["bush_bean"]["component_scores"]["water"] == b["bush_bean"]["component_scores"]["water"]  # not root-zone based
    assert b["carrot"]["soil_used"]["water_used_root_zone"] is True and b["carrot"]["soil_used"]["depth_cm"] == [0, 60]


# 5 ------------------------------------------------------------------


def test_missing_soil_information_is_unknown_never_fabricated():
    no_site = rs.recommend(30, **MILD, irrigation_available=True, previous_crop="wheat")
    for r in no_site["recommendations"]:
        c = r["component_scores"]
        assert c["soil_ph"] is None and c["texture_drainage"] is None and c["fertility"] is None and c["terrain"] is None
        assert set(r["missing_factors"]) == {"soil_ph", "texture_drainage", "fertility", "terrain"}
        assert r["coverage_pct"] == 65.0 and r["soil_used"] is None
        assert r["group_scores"]["soil"] is None and r["group_scores"]["fertility"] is None
    # a site whose soil values are all missing behaves the same way
    empty = copy.deepcopy(CLAY)
    for depth in empty["soil"]["by_depth"].values():
        for item in depth.values():
            item["value"] = None
    empty["soil"]["texture_class"] = {"0-30": None, "0-60": None}
    empty["soil"]["fertility_percentile"] = {"0-30": {}, "0-60": {}}
    r = rs.recommend(30, **MILD, irrigation_available=True, site=empty)["recommendations"][0]
    assert r["component_scores"]["soil_ph"] is None and r["component_scores"]["texture_drainage"] is None and r["component_scores"]["fertility"] is None
    assert r["component_scores"]["terrain"] is not None  # terrain was known in this fixture
    # an unknown factor does not count as a perfect one: the score comes only from what is known
    known = {k: v for k, v in r["component_scores"].items() if v is not None}
    expected = sum(rs.WEIGHTS[k] * v for k, v in known.items()) / sum(rs.WEIGHTS[k] for k in known)
    assert r["score"] == pytest.approx(expected, abs=0.01)


def test_real_grid_without_soil_data_has_no_soil_factors():
    site = env.site_context("JOR_0752")  # central Irbid: the dataset has no SoilGrids values here
    assert site["soil"]["has_data"] is False and site["soil"]["texture_class"] == {"0-30": None, "0-60": None}
    r = rs.recommend(30, **MILD, irrigation_available=True, site=site)["recommendations"][0]
    assert r["component_scores"]["soil_ph"] is None and r["component_scores"]["fertility"] is None
    assert r["component_scores"]["terrain"] is not None  # terrain exists for every grid


# 6 ------------------------------------------------------------------


def test_good_rotation_cannot_rescue_an_unsuitable_crop():
    hot = dict(temperature_c=38.0, humidity_pct=30.0, soil_moisture_m3_m3=0.20, rainfall_mm=5.0)
    out = rs.recommend(30, **hot, irrigation_available=True, site=SANDY, previous_crop="wheat")  # perfect rotation for all
    assert out["status"] == "no_suitable_recommendation" and out["best_candidate"] is None
    for r in out["recommendations"]:
        assert r["component_scores"]["rotation"] == 100 and r["status"] == "not_recommended" and r["score"] < 50
        assert any(c["component"] == "temperature" for c in r["critical_failures"])


def test_frost_sensitive_crop_is_blocked_by_frequent_historical_frost():
    frosty = fixture_site(40, 40, 20, history={"frost_frequency": 0.8, "root_zone_moisture_m3_m3": 0.2, "t2m_max_mean_c": 18.0})
    mild = fixture_site(40, 40, 20, history={"frost_frequency": 0.0, "root_zone_moisture_m3_m3": 0.2, "t2m_max_mean_c": 18.0})
    a, b = by_id(rs.recommend(90, **WARM, irrigation_available=True, site=frosty)), by_id(rs.recommend(90, **WARM, irrigation_available=True, site=mild))
    assert a["bush_bean"]["status"] == "not_recommended" and b["bush_bean"]["status"] != "not_recommended"
    assert a["carrot"]["status"] != "not_recommended"  # frost-tolerant crop is not affected


# other properties ---------------------------------------------------


def test_weights_groups_and_soil_depth_follow_the_crop_table():
    assert sum(rs.WEIGHTS.values()) == 100 and rs.WEIGHTS == {"temperature": 20, "water": 15, "rotation": 20, "texture_drainage": 10, "soil_ph": 10, "fertility": 10, "humidity": 5, "rainfall": 5, "terrain": 5}
    r = by_id(rs.recommend(90, **WARM, irrigation_available=True, site=SANDY, previous_crop="wheat"))
    full = r["carrot"]
    assert full["coverage_pct"] == 100 and full["missing_factors"] == []
    assert full["score"] == pytest.approx(sum(rs.WEIGHTS[k] * v for k, v in full["component_scores"].items()) / 100, abs=0.01)
    assert set(full["group_scores"]) == {"climate", "water", "soil", "fertility", "rotation"}
    assert full["soil_used"]["depth_cm"] == [0, 60] and r["bush_bean"]["soil_used"]["depth_cm"] == [0, 30]
    # every crop keeps the ids, ranges and durations of the original catalog
    assert {c["id"]: (c["horizon"], c["days"]) for c in rs.CATALOG["crops"]} == {
        "radish": (30, [20, 30]), "arugula": (30, [25, 45]), "spinach": (30, [30, 40]), "carrot": (90, [55, 88]), "beet": (90, [50, 60]), "bush_bean": (90, [45, 65]),
    }
    # every added attribute names a reference or says the evidence is insufficient
    for c in rs.CATALOG["crops"]:
        for key in ("texture", "drainage", "moisture", "nutrient_demand"):
            assert c[key]["source"] in rs.CATALOG["references"], (c["id"], key)
        for key in ("rooting", "frost", "heat_limit_c", "humidity_sensitivity"):
            assert c[key].get("source") in rs.CATALOG["references"] or c[key].get("evidence") == "insufficient", (c["id"], key)


def test_fertility_uses_nutrient_demand_and_no_fertilizer_amounts():
    poor, rich = fixture_site(40, 40, 20, fertility=10.0), fixture_site(40, 40, 20, fertility=90.0)
    a, b = by_id(rs.recommend(30, **MILD, irrigation_available=True, site=poor)), by_id(rs.recommend(30, **MILD, irrigation_available=True, site=rich))
    # high-demand leafy greens lose more on poor soil than low-demand radish
    assert a["spinach"]["component_scores"]["fertility"] < a["radish"]["component_scores"]["fertility"]
    assert b["spinach"]["component_scores"]["fertility"] > a["spinach"]["component_scores"]["fertility"]
    text = " ".join(n["en"] for r in a.values() for n in r["explanations"]).lower()
    assert "kg/ha" not in text and "lb" not in text and "apply" not in text


def test_depth_weighting_and_laboratory_override():
    layers = [{"top_cm": 0, "bottom_cm": 5, "ph": 6.0}, {"top_cm": 5, "bottom_cm": 15, "ph": 7.0}, {"top_cm": 15, "bottom_cm": 30, "ph": 8.0}, {"top_cm": 30, "bottom_cm": 60, "ph": None}, {"top_cm": 60, "bottom_cm": 100, "ph": 9.0}]
    assert env.depth_weighted(layers, "ph", 0, 30) == pytest.approx((6 * 5 + 7 * 10 + 8 * 15) / 30, abs=0.001)
    assert env.depth_weighted(layers, "ph", 0, 60) == pytest.approx((6 * 5 + 7 * 10 + 8 * 15) / 30, abs=0.001)  # the empty layer is skipped, not filled
    assert env.depth_weighted(layers, "ph", 30, 60) is None
    est = env.site_context("JOR_0751")
    lab = env.site_context("JOR_0751", soil_overrides={"ph": 6.9})
    assert est["soil"]["by_depth"]["0-30"]["ph"]["source"].startswith("ISRIC SoilGrids")
    assert lab["soil"]["by_depth"]["0-30"]["ph"] == {"value": 6.9, "unit": "pH", "source": "laboratory result (user)"}
    assert lab["soil"]["by_depth"]["0-30"]["clay"] == est["soil"]["by_depth"]["0-30"]["clay"]  # other values keep their source
    assert est["terrain"]["slope_pct"] is not None and est["soil"]["texture_class"]["0-30"] in rs.TEXTURE_GROUP
