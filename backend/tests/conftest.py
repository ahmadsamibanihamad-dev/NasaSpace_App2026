import json
import os
from pathlib import Path

os.environ["OFFLINE_MODE"] = "true"
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-for-hs256-0123456789"
os.environ["RATE_LIMIT_AUTH"] = "1000"
os.environ["RATE_LIMIT_GUEST"] = "1000"
os.environ["AI_MODE"] = "off"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from app.core import db, ratelimit
from app.engine.features import Daily, build_climate

FIXTURES = Path(__file__).parent / "fixtures"
API = "/api/v1"


@pytest.fixture(scope="session")
def climate():
    """Deterministic synthetic climate (the same record the frontend engine was tested with)."""
    return build_climate(Daily.from_lists(json.loads((FIXTURES / "parity.json").read_text(encoding="utf-8"))["daily"]))


@pytest.fixture()
def client(climate, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    db.set_engine(engine)
    from app import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    from app.api import analyses, forecasts, public
    from app.main import create_app
    from app.ml import service

    # never touch the network in tests: every location gets the synthetic climate
    for mod in (analyses, forecasts, public):
        monkeypatch.setattr(mod, "get_climate", lambda session, lat, lon: climate)
    ratelimit.reset()
    service.set_prediction_service(None)
    with TestClient(create_app()) as c:
        yield c
    service.set_prediction_service(None)
    db.set_engine(None)


def auth_headers(client, email="farmer@example.com"):
    r = client.post(f"{API}/auth/register", json={"email": email, "password": "password123", "full_name": "Test Farmer"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def square(lat=32.5568, lon=35.8469, d=0.0005):
    """About 100 m x 94 m parcel near Irbid."""
    return {"type": "Polygon", "coordinates": [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]]}


def make_farm(client, h, name="Test farm"):
    r = client.post(f"{API}/farms", json={"name": name, "lat": 32.5568, "lon": 35.8469}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_plot(client, h, farm_id, label="1", **extra):
    body = {"label": label, "name": f"Parcel {label}", "polygon": square(lon=35.8469 + 0.002 * (int(label) if label.isdigit() else 0)), **extra}
    r = client.post(f"{API}/farms/{farm_id}/plots", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()
