"""SQLModel tables. GeoJSON and result payloads are stored as JSON columns."""

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
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    name: str
    governorate_id: Optional[str] = None
    boundary: dict = Field(sa_column=Column(JSON, nullable=False))
    area_m2: float
    centroid_lat: float
    centroid_lon: float
    is_demo: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class Plot(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    farm_id: str = Field(foreign_key="farm.id", index=True, ondelete="CASCADE")
    label: str
    name: str = ""
    polygon: dict = Field(sa_column=Column(JSON, nullable=False))
    area_m2: float
    excluded: bool = False
    exclusion_reason: Optional[str] = None
    current_crop_id: Optional[str] = None
    previous_crop_id: Optional[str] = None
    irrigation_available: bool = False
    irrigation_method: Optional[str] = None
    soil_type: Optional[str] = None
    soil_ph: Optional[float] = None


class CropHistory(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    plot_id: str = Field(foreign_key="plot.id", index=True, ondelete="CASCADE")
    season: str  # e.g. "2024-2025"
    crop_id: Optional[str] = None  # None = fallow


class Analysis(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    farm_id: str = Field(foreign_key="farm.id", index=True, ondelete="CASCADE")
    analysis_type: str
    scope: str = "farm"
    inputs: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    status: str = "queued"
    stage: Optional[str] = None
    result: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    error: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    created_at: datetime = Field(default_factory=utcnow, index=True)
    completed_at: Optional[datetime] = None


class EnvCache(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("source", "cell_lat", "cell_lon", "start", "end", name="uq_envcache"),)
    id: str = Field(default_factory=new_id, primary_key=True)
    source: str  # e.g. "POWER"
    cell_lat: float
    cell_lon: float
    start: str  # YYYYMMDD
    end: str
    payload: Any = Field(sa_column=Column(JSON, nullable=False))
    fetched_at: datetime = Field(default_factory=utcnow)
