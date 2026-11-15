"""Request / response schemas. Shapes match frontend/src/lib/types.ts."""

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

IrrigationMethod = Literal["drip", "sprinkler", "surface", "none"]
SoilType = Literal["clay", "loam", "sandy", "silty", "calcareous", "unknown"]
PlotStatus = Literal["planted", "fallow", "preparing", "unused"]
CultivationType = Literal["open_field", "greenhouse"]


# ---------------- auth ----------------


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    language: str
    area_unit: str
    created_at: datetime


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ForgotIn(BaseModel):
    email: EmailStr


class UserUpdateIn(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    language: Optional[Literal["ar", "en"]] = None
    area_unit: Optional[Literal["dunum", "hectare", "m2"]] = None


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------------- geo ----------------


class Governorate(BaseModel):
    id: str
    name_ar: str
    name_en: str


class LocateOut(BaseModel):
    lat: float
    lon: float
    inside_jordan: bool
    governorate: Optional[Governorate]


# ---------------- farms and parcels ----------------


class FarmIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    owner_name: str = Field(default="", max_length=80)
    owner_phone: str = Field(default="", max_length=20, pattern=r"^[\d+\s-]*$")


class FarmUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    owner_name: Optional[str] = Field(default=None, max_length=80)
    owner_phone: Optional[str] = Field(default=None, max_length=20, pattern=r"^[\d+\s-]*$")


class FarmOut(BaseModel):
    id: str
    user_id: str
    name: str
    governorate: Optional[Governorate]
    centroid: dict
    owner_name: str
    owner_phone: str
    is_demo: bool
    plots_count: int
    area_m2: float
    created_at: datetime


class PlotIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    label: str = Field(min_length=1, max_length=12)
    name: str = Field(min_length=1, max_length=80)
    region: str = Field(default="", max_length=80)
    polygon: dict
    color: str = Field(default="#2F8F4E", pattern=r"^#[0-9A-Fa-f]{6}$")
    status: PlotStatus = "fallow"
    notes: str = Field(default="", max_length=500)
    owner_name: str = Field(default="", max_length=80)
    owner_phone: str = Field(default="", max_length=20, pattern=r"^[\d+\s-]*$")
    current_crop_id: Optional[str] = None
    previous_crop_id: Optional[str] = None
    irrigation_available: bool = False
    irrigation_method: Optional[IrrigationMethod] = None
    cultivation_type: CultivationType = "open_field"
    soil_type: Optional[SoilType] = None
    soil_ph: Optional[float] = Field(default=None, ge=3.0, le=10.5)


class PlotUpdateIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    label: Optional[str] = Field(default=None, min_length=1, max_length=12)
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    region: Optional[str] = Field(default=None, max_length=80)
    polygon: Optional[dict] = None
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    status: Optional[PlotStatus] = None
    notes: Optional[str] = Field(default=None, max_length=500)
    owner_name: Optional[str] = Field(default=None, max_length=80)
    owner_phone: Optional[str] = Field(default=None, max_length=20, pattern=r"^[\d+\s-]*$")
    current_crop_id: Optional[str] = None
    previous_crop_id: Optional[str] = None
    irrigation_available: Optional[bool] = None
    irrigation_method: Optional[IrrigationMethod] = None
    cultivation_type: Optional[CultivationType] = None
    soil_type: Optional[SoilType] = None
    soil_ph: Optional[float] = Field(default=None, ge=3.0, le=10.5)


class PlotOut(BaseModel):
    id: str
    farm_id: str
    label: str
    name: str
    region: str
    polygon: dict
    area_m2: float
    perimeter_m: float
    color: str
    status: str
    notes: str
    owner_name: str
    owner_phone: str
    current_crop_id: Optional[str]
    previous_crop_id: Optional[str]
    irrigation_available: bool
    irrigation_method: Optional[str]
    cultivation_type: str
    soil_type: Optional[str]
    soil_ph: Optional[float]
    created_at: datetime
    updated_at: datetime


class HistoryItem(BaseModel):
    id: Optional[str] = None
    season: str = Field(pattern=r"^\d{4}(-\d{4})?$")
    crop_id: Optional[str] = None


class HistoryReplaceIn(BaseModel):
    items: list[HistoryItem] = Field(max_length=10)
