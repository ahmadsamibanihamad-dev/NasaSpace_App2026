"""Observed environment endpoints (NASA POWER record; synthetic climate in tests) and system status."""

from .conftest import API, auth_headers


def test_environment_summary_and_series(client):
    h = auth_headers(client)
    assert client.get(f"{API}/environment/summary", params={"lat": 32.5568, "lon": 35.8469}).status_code == 401
    s = client.get(f"{API}/environment/summary", params={"lat": 32.5568, "lon": 35.8469}, headers=h)
    assert s.status_code == 200, s.text
    for variable in ("temperature", "rainfall", "soil_moisture", "humidity", "solar_radiation"):
        for resolution in ("daily", "monthly", "seasonal", "annual"):
            r = client.get(f"{API}/environment/timeseries", params={"lat": 32.5568, "lon": 35.8469, "variable": variable, "resolution": resolution}, headers=h)
            assert r.status_code == 200 and len(r.json()["points"]) > 0, (variable, resolution)
    out = client.get(f"{API}/environment/summary", params={"lat": 33.51, "lon": 36.29}, headers=h)
    assert out.status_code == 422 and out.json()["error"]["code"] == "UNSUPPORTED_LOCATION"


def test_health_reports_the_teams_rules_and_crops(client):
    h = client.get(f"{API}/health").json()
    assert h["ok"] is True and h["recommendation_rules"] == "mvp-1"
    assert h["crops"] == ["arugula", "beet", "bush_bean", "carrot", "radish", "spinach"]


def test_removed_endpoints_are_gone(client):
    assert client.post(f"{API}/guest/recommendations", json={"lat": 32.55, "lon": 35.85}).status_code == 404
    assert client.get(f"{API}/crops").status_code == 404
    assert client.post(f"{API}/analyses", json={}).status_code in (404, 405)
