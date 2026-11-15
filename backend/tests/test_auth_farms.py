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


def test_overlapping_parcels_are_refused_but_neighbours_are_not(client):
    h = auth_headers(client)
    farm = make_farm(client, h)
    first = make_plot(client, h, farm["id"], "1")  # square around lon 35.8489, half-width 0.0005
    lon = 35.8469 + 0.002
    # shares a whole border with parcel 1: allowed
    r = client.post(f"{API}/farms/{farm['id']}/plots", json={"label": "2", "name": "Neighbour", "polygon": square(lon=lon + 0.001)}, headers=h)
    assert r.status_code == 201, r.text
    # covers half of parcel 1: refused, with the number of the parcel it overlaps
    r = client.post(f"{API}/farms/{farm['id']}/plots", json={"label": "3", "name": "Overlap", "polygon": square(lon=lon - 0.0005)}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_GEOMETRY" and r.json()["error"]["details"] == ["overlaps_parcel", "1"]
    # a sliver (1 % of the parcel) is tolerated
    r = client.post(f"{API}/farms/{farm['id']}/plots", json={"label": "4", "name": "Sliver", "polygon": square(lon=lon - 0.00099)}, headers=h)
    assert r.status_code == 201, r.text
    # moving a boundary onto another parcel is refused; saving a parcel's own boundary again is fine
    r = client.patch(f"{API}/plots/{first['id']}", json={"polygon": square(lon=lon + 0.0008)}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["details"][0] == "overlaps_parcel"
    assert client.patch(f"{API}/plots/{first['id']}", json={"polygon": first["polygon"]}, headers=h).status_code == 200
    # another farm's parcels do not count
    other = make_farm(client, h, "Other farm")
    assert client.post(f"{API}/farms/{other['id']}/plots", json={"label": "1", "name": "Same place", "polygon": first["polygon"]}, headers=h).status_code == 201


def test_laboratory_soil_test_is_stored_with_the_parcel(client):
    h = auth_headers(client)
    farm = make_farm(client, h)
    p = make_plot(client, h, farm["id"], "1", soil_lab={"ph": 6.9, "sand": 70, "silt": 20, "clay": 10, "cec": 14.5})
    assert p["soil_lab"] == {"ph": 6.9, "sand": 70.0, "silt": 20.0, "clay": 10.0, "cec": 14.5}
    assert make_plot(client, h, farm["id"], "2")["soil_lab"] is None
    # sand, silt and clay are one measurement; out-of-range values are refused
    for bad in ({"sand": 70}, {"ph": 15}, {"clay": 120, "sand": 1, "silt": 1}):
        r = client.patch(f"{API}/plots/{p['id']}", json={"soil_lab": bad}, headers=h)
        assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR", bad
    r = client.patch(f"{API}/plots/{p['id']}", json={"soil_lab": {"ph": 7.4}}, headers=h)
    assert r.status_code == 200 and r.json()["soil_lab"] == {"ph": 7.4}
    # other edits leave it alone; null clears it
    assert client.patch(f"{API}/plots/{p['id']}", json={"name": "Renamed"}, headers=h).json()["soil_lab"] == {"ph": 7.4}
    assert client.patch(f"{API}/plots/{p['id']}", json={"soil_lab": None}, headers=h).json()["soil_lab"] is None


def test_database_made_by_an_earlier_version_gets_the_new_column():
    from sqlalchemy import inspect, text
    from sqlmodel import create_engine

    from app.core import db

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE plot (id VARCHAR PRIMARY KEY, label VARCHAR)"))
        conn.execute(text("INSERT INTO plot VALUES ('a', '1')"))
    previous = db._engine
    db.set_engine(engine)
    try:
        db._add_missing_columns()
        db._add_missing_columns()  # running it again changes nothing
        assert "soil_lab" in {c["name"] for c in inspect(engine).get_columns("plot")}
        with engine.begin() as conn:
            assert conn.execute(text("SELECT id, label, soil_lab FROM plot")).all() == [("a", "1", None)]
    finally:
        db.set_engine(previous)
