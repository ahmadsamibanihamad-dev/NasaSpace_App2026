"""SQLModel tables (SQLite). GeoJSON and result payloads are stored as JSON columns."""

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    email: str = Field(index=True, unique=True)
    full_name: str = ""
    password_hash: str
    language: str = "ar"
    area_unit: str = "dunum"
    created_at: datetime = Field(default_factory=utcnow)


class Farm(SQLModel, table=True):
    """A farm is a named location owned by a user; its land is described by its parcels."""

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    name: str
    governorate_id: Optional[str] = None
    centroid_lat: float
    centroid_lon: float
    owner_name: str = ""
    owner_phone: str = ""
    is_demo: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class Plot(SQLModel, table=True):
    """A parcel drawn on the map. `label` is the parcel number, unique inside a farm."""

    __table_args__ = (UniqueConstraint("farm_id", "label", name="uq_plot_farm_label"),)
    id: str = Field(default_factory=new_id, primary_key=True)
    farm_id: str = Field(foreign_key="farm.id", index=True)
    label: str
    name: str = ""
    region: str = ""
    polygon: dict = Field(sa_column=Column(JSON, nullable=False))
    area_m2: float
    perimeter_m: float = 0
    color: str = "#2F8F4E"
    status: str = "fallow"
    notes: str = ""
    owner_name: str = ""
    owner_phone: str = ""
    current_crop_id: Optional[str] = None
    previous_crop_id: Optional[str] = None
    irrigation_available: bool = False
    irrigation_method: Optional[str] = None
    cultivation_type: str = "open_field"
    soil_type: Optional[str] = None
    soil_ph: Optional[float] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class CropHistory(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("plot_id", "season", name="uq_history_plot_season"),)
    id: str = Field(default_factory=new_id, primary_key=True)
    plot_id: str = Field(foreign_key="plot.id", index=True)
    season: str  # e.g. "2024-2025"
    crop_id: Optional[str] = None  # None = fallow


class Analysis(SQLModel, table=True):
    """A saved analysis: the history of a signed-in user. Guests never get a row here."""

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    farm_id: str = Field(foreign_key="farm.id", index=True)
    analysis_type: str
    scope: str = "farm"
    inputs: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    status: str = "queued"
    stage: Optional[str] = None
    result: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    error: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    summary: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    created_at: datetime = Field(default_factory=utcnow, index=True)
    completed_at: Optional[datetime] = None


class EnvCache(SQLModel, table=True):
    """Cached daily climate record for one 0.5-degree cell (one row per source and cell)."""

    __table_args__ = (UniqueConstraint("source", "cell", name="uq_envcache_source_cell"),)
    id: str = Field(default_factory=new_id, primary_key=True)
    source: str  # e.g. "POWER"
    cell: str  # "32.5_36.0"
    payload: Any = Field(sa_column=Column(JSON, nullable=False))
    last_date: str = ""  # latest observation date in the payload
    fetched_at: datetime = Field(default_factory=utcnow)


class Forecast(SQLModel, table=True):
    """A forecast produced by the AI prediction service for a signed-in user."""

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    farm_id: Optional[str] = Field(default=None, index=True)
    request: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    response: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    data_mode: str = "mock"
    created_at: datetime = Field(default_factory=utcnow, index=True)
