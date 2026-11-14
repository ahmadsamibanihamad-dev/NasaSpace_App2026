from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

IrrigationMethod = Literal["drip", "sprinkler", "surface", "none"]
SoilType = Literal["clay", "loam", "sandy", "silty", "calcareous", "unknown"]


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
    area_unit: Optional[Literal["dunum", "hectare"]] = None


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class Governorate(BaseModel):
    id: str
    name_ar: str
    name_en: str


class LocateOut(BaseModel):
    lat: float
    lon: float
    inside_jordan: bool
    governorate: Optional[Governorate]


class FarmIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    boundary: dict


class FarmUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    boundary: Optional[dict] = None


class FarmOut(BaseModel):
    id: str
    name: str
    governorate: Optional[Governorate]
    boundary: dict
    area_m2: float
    centroid: dict
    plots_count: int
    is_demo: bool
    created_at: datetime


class PlotIn(BaseModel):
    label: str = Field(min_length=1, max_length=12)
    name: str = Field(default="", max_length=80)
    polygon: dict
    excluded: bool = False
    exclusion_reason: Optional[str] = Field(default=None, max_length=40)


class PlotsReplaceIn(BaseModel):
    plots: list[PlotIn] = Field(min_length=1, max_length=400)

    @field_validator("plots")
    @classmethod
    def unique_labels(cls, v: list[PlotIn]):
        labels = [p.label for p in v]
        if len(set(labels)) != len(labels):
            raise ValueError("Plot labels must be unique")
        return v


class PlotDetailsItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    current_crop_id: Optional[str] = None
    previous_crop_id: Optional[str] = None
    irrigation_available: bool = False
    irrigation_method: Optional[IrrigationMethod] = None
    soil_type: Optional[SoilType] = None
    soil_ph: Optional[float] = Field(default=None, ge=3.0, le=10.5)


class PlotDetailsBulkIn(BaseModel):
    items: list[PlotDetailsItem] = Field(min_length=1)


class PlotUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)
    current_crop_id: Optional[str] = None
    previous_crop_id: Optional[str] = None
    irrigation_available: Optional[bool] = None
    irrigation_method: Optional[IrrigationMethod] = None
    soil_type: Optional[SoilType] = None
    soil_ph: Optional[float] = Field(default=None, ge=3.0, le=10.5)


class PlotOut(BaseModel):
    id: str
    farm_id: str
    label: str
    name: str
    polygon: dict
    area_m2: float
    excluded: bool
    exclusion_reason: Optional[str]
    current_crop_id: Optional[str]
    previous_crop_id: Optional[str]
    irrigation_available: bool
    irrigation_method: Optional[str]
    soil_type: Optional[str]
    soil_ph: Optional[float]
    latest_score: Optional[float] = None
    latest_status: Optional[str] = None
    latest_top_risk: Optional[dict] = None


class HistoryItem(BaseModel):
    id: Optional[str] = None
    season: str = Field(pattern=r"^\d{4}(-\d{4})?$")
    crop_id: Optional[str] = None


class HistoryReplaceIn(BaseModel):
    items: list[HistoryItem] = Field(max_length=10)


AnalysisType = Literal["crop_suitability", "crop_recommendation", "planting_window", "rotation", "water", "risk"]


class AnalysisIn(BaseModel):
    analysis_type: AnalysisType
    farm_id: str
    plot_ids: Optional[list[str]] = None  # None = whole farm
    crop_id: Optional[str] = None
    planting_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    priority: Optional[Literal["save_water", "improve_soil", "increase_income"]] = None


class AnalysisCreated(BaseModel):
    analysis_id: str
    status: str


class AnalysisOut(BaseModel):
    id: str
    farm_id: str
    analysis_type: str
    scope: str
    inputs: dict
    status: str
    stage: Optional[str]
    stages: list[dict]
    result: Optional[dict[str, Any]]
    error: Optional[dict]
    created_at: datetime
    completed_at: Optional[datetime]
    summary: Optional[dict] = None
