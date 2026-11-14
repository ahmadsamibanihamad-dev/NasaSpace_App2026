import os

os.environ["OFFLINE_MODE"] = "true"
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-for-hs256-0123456789"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from app.core import db


@pytest.fixture()
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    db.set_engine(engine)
    from app import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c
    db.set_engine(None)


def auth_headers(client, email="farmer@example.com"):
    r = client.post("/api/v1/auth/register", json={"email": email, "password": "password123", "full_name": "Test Farmer"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ~25 dunum square near Al Husn, Irbid (approx 158 m x 158 m)
def square(lat=32.5568, lon=35.8469, d=0.00075):
    return {
        "type": "Polygon",
        "coordinates": [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]],
    }
