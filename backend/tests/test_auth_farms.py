from tests.conftest import auth_headers, square

API = "/api/v1"


def test_register_login_me(client):
    h = auth_headers(client)
    me = client.get(f"{API}/auth/me", headers=h)
    assert me.status_code == 200
    assert me.json()["email"] == "farmer@example.com"
    r = client.post(f"{API}/auth/login", json={"email": "FARMER@example.com", "password": "password123"})
    assert r.status_code == 200
    bad = client.post(f"{API}/auth/login", json={"email": "farmer@example.com", "password": "wrong-pass"})
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_duplicate_email_and_validation(client):
    auth_headers(client)
    r = client.post(f"{API}/auth/register", json={"email": "farmer@example.com", "password": "password123", "full_name": "X"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "EMAIL_TAKEN"
    r = client.post(f"{API}/auth/register", json={"email": "x@example.com", "password": "short", "full_name": "X"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_unauthorized(client):
    assert client.get(f"{API}/farms").status_code == 401
    assert client.get(f"{API}/auth/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_forgot_password_stub(client):
    r = client.post(f"{API}/auth/forgot-password", json={"email": "a@b.co"})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_geo_locate(client):
    r = client.get(f"{API}/geo/locate", params={"lat": 32.5568, "lon": 35.8469}).json()
    assert r["inside_jordan"] is True
    assert r["governorate"]["id"] == "ir"
    assert r["governorate"]["name_ar"] == "إربد"
    amman = client.get(f"{API}/geo/locate", params={"lat": 31.95, "lon": 35.93}).json()
    assert amman["governorate"]["id"] == "am"
    aqaba = client.get(f"{API}/geo/locate", params={"lat": 29.55, "lon": 35.02}).json()
    assert aqaba["inside_jordan"] and aqaba["governorate"]["id"] == "aq"
    # Damascus, Jerusalem, Riyadh -> outside
    for lat, lon in [(33.51, 36.29), (31.77, 35.21), (24.71, 46.67)]:
        out = client.get(f"{API}/geo/locate", params={"lat": lat, "lon": lon}).json()
        assert out["inside_jordan"] is False and out["governorate"] is None


def test_farm_crud_and_jordan_validation(client):
    h = auth_headers(client)
    r = client.post(f"{API}/farms", json={"name": "Test", "boundary": square()}, headers=h)
    assert r.status_code == 201, r.text
    farm = r.json()
    assert farm["governorate"]["id"] == "ir"
    assert 20_000 < farm["area_m2"] < 27_000
    # outside Jordan (Damascus)
    r = client.post(f"{API}/farms", json={"name": "X", "boundary": square(33.51, 36.29)}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNSUPPORTED_LOCATION"
    # rename
    r = client.patch(f"{API}/farms/{farm['id']}", json={"name": "Renamed"}, headers=h)
    assert r.json()["name"] == "Renamed"
    # other users cannot see it
    h2 = auth_headers(client, "other@example.com")
    assert client.get(f"{API}/farms/{farm['id']}", headers=h2).status_code == 404
    assert client.delete(f"{API}/farms/{farm['id']}", headers=h).status_code == 204
    assert client.get(f"{API}/farms", headers=h).json() == []


def _halves(lat=32.5568, lon=35.8469, d=0.00075):
    left = {"type": "Polygon", "coordinates": [[[lon - d, lat - d], [lon, lat - d], [lon, lat + d], [lon - d, lat + d], [lon - d, lat - d]]]}
    right = {"type": "Polygon", "coordinates": [[[lon, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon, lat + d], [lon, lat - d]]]}
    return left, right


def test_plots_replace_details_history(client):
    h = auth_headers(client)
    farm = client.post(f"{API}/farms", json={"name": "Test", "boundary": square()}, headers=h).json()
    left, right = _halves()
    r = client.put(f"{API}/farms/{farm['id']}/plots", json={"plots": [{"label": "A1", "polygon": left}, {"label": "A2", "polygon": right}]}, headers=h)
    assert r.status_code == 200, r.text
    plots = r.json()
    assert [p["label"] for p in plots] == ["A1", "A2"]
    assert abs(sum(p["area_m2"] for p in plots) - farm["area_m2"]) < 5
    a1 = plots[0]["id"]

    r = client.patch(
        f"{API}/farms/{farm['id']}/plots/details",
        json={"items": [{"id": a1, "current_crop_id": "wheat", "previous_crop_id": "lentil", "irrigation_available": True, "irrigation_method": "drip", "soil_ph": 7.8}]},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()[0]["current_crop_id"] == "wheat"
    bad = client.patch(f"{API}/farms/{farm['id']}/plots/details", json={"items": [{"id": a1, "current_crop_id": "banana"}]}, headers=h)
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "UNSUPPORTED_CROP"

    # replacing again with the same label keeps the plot id and details
    r = client.put(f"{API}/farms/{farm['id']}/plots", json={"plots": [{"label": "A1", "polygon": left}, {"label": "A2", "polygon": right, "excluded": True, "exclusion_reason": "house"}]}, headers=h)
    again = r.json()
    assert again[0]["id"] == a1 and again[0]["current_crop_id"] == "wheat"
    assert again[1]["excluded"] is True

    hist = client.put(f"{API}/plots/{a1}/history", json={"items": [{"season": "2023-2024", "crop_id": "lentil"}, {"season": "2024-2025", "crop_id": None}]}, headers=h)
    assert hist.status_code == 200, hist.text
    assert [x["crop_id"] for x in hist.json()] == ["lentil", None]


def test_plot_validation(client):
    h = auth_headers(client)
    farm = client.post(f"{API}/farms", json={"name": "Test", "boundary": square()}, headers=h).json()
    tiny = square(d=0.00005)  # ~ 0.1 dunum
    r = client.put(f"{API}/farms/{farm['id']}/plots", json={"plots": [{"label": "A1", "polygon": tiny}]}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "PLOT_TOO_SMALL"
    far = square(lat=32.6)
    r = client.put(f"{API}/farms/{farm['id']}/plots", json={"plots": [{"label": "A1", "polygon": far}]}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "PLOT_OUTSIDE_FARM"
    r = client.put(f"{API}/farms/{farm['id']}/plots", json={"plots": [{"label": "A1", "polygon": square()}, {"label": "A2", "polygon": square()}]}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "PLOTS_OVERLAP"
