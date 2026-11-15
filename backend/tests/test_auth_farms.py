from tests.conftest import API, auth_headers, make_farm, make_plot, square


def test_register_login_me(client):
    h = auth_headers(client)
    me = client.get(f"{API}/auth/me", headers=h)
    assert me.status_code == 200 and me.json()["email"] == "farmer@example.com"
    assert client.post(f"{API}/auth/login", json={"email": "FARMER@example.com", "password": "password123"}).status_code == 200
    bad = client.post(f"{API}/auth/login", json={"email": "farmer@example.com", "password": "wrong-pass"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "INVALID_CREDENTIALS"
    upd = client.patch(f"{API}/auth/me", json={"language": "en", "area_unit": "m2"}, headers=h)
    assert upd.json()["language"] == "en" and upd.json()["area_unit"] == "m2"


def test_duplicate_email_and_validation(client):
    auth_headers(client)
    r = client.post(f"{API}/auth/register", json={"email": "farmer@example.com", "password": "password123", "full_name": "X"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "EMAIL_TAKEN"
    r = client.post(f"{API}/auth/register", json={"email": "x@example.com", "password": "short", "full_name": "X"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_everything_user_owned_needs_a_token(client):
    for method, path in [("get", "/farms"), ("get", "/auth/me"), ("get", "/analyses?farm_id=x"), ("get", "/forecasts/history"), ("get", "/environment/summary?lat=32&lon=36")]:
        assert getattr(client, method)(f"{API}{path}").status_code == 401, path
    assert client.get(f"{API}/auth/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_password_is_hashed(client):
    from sqlmodel import Session, select

    from app.core.db import get_engine
    from app.models import User

    auth_headers(client)
    with Session(get_engine()) as s:
        u = s.exec(select(User)).first()
    assert "password123" not in u.password_hash and u.password_hash.startswith("$argon2")


def test_geo_locate(client):
    r = client.get(f"{API}/geo/locate", params={"lat": 32.5568, "lon": 35.8469}).json()
    assert r["inside_jordan"] is True and r["governorate"]["id"] == "ir" and r["governorate"]["name_ar"] == "إربد"
    assert client.get(f"{API}/geo/locate", params={"lat": 31.95, "lon": 35.93}).json()["governorate"]["id"] == "am"
    for lat, lon in [(33.51, 36.29), (31.77, 35.21), (24.71, 46.67)]:  # Damascus, Jerusalem, Riyadh
        out = client.get(f"{API}/geo/locate", params={"lat": lat, "lon": lon}).json()
        assert out["inside_jordan"] is False and out["governorate"] is None


def test_farm_crud_and_isolation(client):
    h = auth_headers(client)
    farm = make_farm(client, h)
    assert farm["governorate"]["id"] == "ir" and farm["plots_count"] == 0 and farm["is_demo"] is False
    r = client.post(f"{API}/farms", json={"name": "X", "lat": 33.51, "lon": 36.29}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNSUPPORTED_LOCATION"
    r = client.patch(f"{API}/farms/{farm['id']}", json={"name": "Renamed", "owner_name": "Abu Ahmad"}, headers=h)
    assert r.json()["name"] == "Renamed" and r.json()["owner_name"] == "Abu Ahmad"
    h2 = auth_headers(client, "other@example.com")
    assert client.get(f"{API}/farms/{farm['id']}", headers=h2).status_code == 404
    assert client.get(f"{API}/farms/{farm['id']}/plots", headers=h2).status_code == 404
    assert client.get(f"{API}/farms", headers=h2).json() == []
    assert client.delete(f"{API}/farms/{farm['id']}", headers=h).status_code == 204
    assert client.get(f"{API}/farms", headers=h).json() == []


def test_parcel_lifecycle(client):
    h = auth_headers(client)
    farm = make_farm(client, h)
    p = make_plot(client, h, farm["id"], "1", current_crop_id="wheat", irrigation_available=True, irrigation_method="drip", color="#2F7FD1", owner_name="Sami")
    assert 9000 < p["area_m2"] < 11000 and 400 < p["perimeter_m"] < 420
    assert p["irrigation_method"] == "drip" and p["color"] == "#2F7FD1" and p["cultivation_type"] == "open_field"
    assert client.get(f"{API}/farms/{farm['id']}/plots/next-label", headers=h).json()["label"] == "2"

    # duplicate number, unknown crop
    dup = client.post(f"{API}/farms/{farm['id']}/plots", json={"label": "1", "name": "again", "polygon": square()}, headers=h)
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "DUPLICATE_LABEL"
    bad = client.post(f"{API}/farms/{farm['id']}/plots", json={"label": "9", "name": "x", "polygon": square(), "current_crop_id": "banana"}, headers=h)
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "UNSUPPORTED_CROP"

    # edit data, then reshape: area and perimeter follow the new boundary
    r = client.patch(f"{API}/plots/{p['id']}", json={"name": "North field", "status": "planted", "soil_ph": 7.8, "cultivation_type": "greenhouse"}, headers=h)
    assert r.status_code == 200 and r.json()["name"] == "North field" and r.json()["cultivation_type"] == "greenhouse"
    bigger = client.patch(f"{API}/plots/{p['id']}", json={"polygon": square(d=0.001)}, headers=h).json()
    assert bigger["area_m2"] > p["area_m2"] * 3.5 and bigger["name"] == "North field"

    make_plot(client, h, farm["id"], "2")
    farm_now = client.get(f"{API}/farms/{farm['id']}", headers=h).json()
    assert farm_now["plots_count"] == 2 and farm_now["area_m2"] > 45000

    hist = client.put(f"{API}/plots/{p['id']}/history", json={"items": [{"season": "2024-2025", "crop_id": "lentil"}, {"season": "2025-2026", "crop_id": None}]}, headers=h)
    assert [x["crop_id"] for x in hist.json()] == ["lentil", None]
    assert client.put(f"{API}/plots/{p['id']}/history", json={"items": [{"season": "2024-2025", "crop_id": "wheat"}, {"season": "2024-2025", "crop_id": "barley"}]}, headers=h).status_code == 422

    h2 = auth_headers(client, "other@example.com")
    assert client.patch(f"{API}/plots/{p['id']}", json={"name": "hacked"}, headers=h2).status_code == 404
    assert client.delete(f"{API}/plots/{p['id']}", headers=h2).status_code == 404
    assert client.delete(f"{API}/plots/{p['id']}", headers=h).status_code == 204
    assert [x["label"] for x in client.get(f"{API}/farms/{farm['id']}/plots", headers=h).json()] == ["2"]


def test_invalid_parcel_shapes_are_rejected_with_a_reason(client):
    h = auth_headers(client)
    farm = make_farm(client, h)
    lon, lat = 35.8469, 32.5568
    cases = {
        "too_few_points": {"type": "Polygon", "coordinates": [[[lon, lat], [lon + 0.001, lat], [lon, lat]]]},
        "self_intersecting": {"type": "Polygon", "coordinates": [[[lon, lat], [lon + 0.001, lat + 0.001], [lon + 0.001, lat], [lon, lat + 0.001], [lon, lat]]]},
        "too_small": square(d=0.00001),
        "outside_jordan": square(lat=33.51, lon=36.29),
        "out_of_range": {"type": "Polygon", "coordinates": [[[lon, 95], [lon + 1, 95], [lon + 1, 96], [lon, 95]]]},
    }
    for reason, poly in cases.items():
        r = client.post(f"{API}/farms/{farm['id']}/plots", json={"label": "1", "name": "x", "polygon": poly}, headers=h)
        assert r.status_code == 422, reason
        assert reason in r.json()["error"]["details"], (reason, r.json())
    assert client.get(f"{API}/farms/{farm['id']}/plots", headers=h).json() == []


def test_demo_farm(client):
    h = auth_headers(client)
    farm = client.post(f"{API}/farms/demo", headers=h).json()
    assert farm["is_demo"] is True and farm["plots_count"] == 6 and 24000 < farm["area_m2"] < 26000
    plots = client.get(f"{API}/farms/{farm['id']}/plots", headers=h).json()
    assert [p["label"] for p in plots] == ["A1", "A2", "A3", "B1", "B2", "B3"]
    assert [p["current_crop_id"] for p in plots] == ["wheat", "wheat", "barley", "lentil", None, "tomato"]
    assert len(client.get(f"{API}/plots/{plots[0]['id']}/history", headers=h).json()) == 3


def test_rate_limit():
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from app.core import ratelimit
    from app.core.errors import install_error_handlers

    ratelimit.reset()
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/x", dependencies=[Depends(ratelimit.limit("t", 3))])
    def x():
        return {"ok": True}

    c = TestClient(app)
    assert [c.get("/x").status_code for _ in range(4)] == [200, 200, 200, 429]
    assert c.get("/x").json()["error"]["code"] == "RATE_LIMITED"


def test_deleting_a_farm_removes_its_parcels_history_and_analyses(client):
    """A farm that has been used (parcels, crop history, analyses) must still be deletable."""
    h = auth_headers(client)
    farm = client.post(f"{API}/farms/demo", headers=h).json()
    plots = client.get(f"{API}/farms/{farm['id']}/plots", headers=h).json()
    assert len(plots) == 6
    a = client.post(f"{API}/analyses", json={"analysis_type": "risk", "farm_id": farm["id"], "plot_ids": None}, headers=h).json()
    assert client.get(f"{API}/analyses/{a['analysis_id']}", headers=h).json()["status"] == "completed"
    # one parcel with history first, then the whole farm
    assert client.delete(f"{API}/plots/{plots[0]['id']}", headers=h).status_code == 204
    assert client.delete(f"{API}/farms/{farm['id']}", headers=h).status_code == 204
    assert client.get(f"{API}/farms", headers=h).json() == []
    assert client.get(f"{API}/analyses/{a['analysis_id']}", headers=h).status_code == 404
    assert client.get(f"{API}/plots/{plots[1]['id']}", headers=h).status_code == 404
