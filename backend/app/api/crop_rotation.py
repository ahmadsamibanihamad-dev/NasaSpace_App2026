"""Crop Rotation Planner API.

The planning logic is `nasa_final/AI/crop_rotation.py`; the forecasts come from the same function
the outlook uses (`forecast_context`), so both features share location matching, forecast origin
and cached models. This module only validates input, adds calendar dates, and stores plans that a
signed-in user chooses to keep.

    POST   /crop-rotation/plan          anyone (rate-limited); nothing is stored
    POST   /crop-rotation/plans         signed in: compute and save for a farm
    GET    /crop-rotation/plans         signed in: saved plans of a farm
    GET    /crop-rotation/plans/{id}    signed in: one saved plan
    DELETE /crop-rotation/plans/{id}    signed in
"""

from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlmodel import Session, col, select

from app.api.deps import current_user, owned_farm
from app.api.outlook import _both, forecast_context
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import AppError
from app.core.ratelimit import limit
from app.models import Plot, RotationPlan, User

router = APIRouter(prefix="/crop-rotation", tags=["crop rotation"])
_s = get_settings()

CropId = Literal["radish", "arugula", "spinach", "carrot", "beet", "bush_bean"]


class PlanIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    planning_horizon_days: Literal[30, 90] = 90
    # Omitted = the default date of the available data. A date outside the data is refused.
    planting_date: Optional[date] = None
    previous_crop: Optional[CropId] = None  # None = unknown
    irrigation_available: Optional[bool] = None
    # Recorded with the plan. It is not an input of the forecasting models or of the rules.
    cultivation_type: Optional[Literal["open_field", "greenhouse"]] = None


class SavePlanIn(PlanIn):
    farm_id: str
    plot_id: Optional[str] = None


def _add_dates(rotation: Optional[dict], planting: date) -> None:
    """Calendar dates next to the day numbers the planner returns (day 1 = the planting date)."""
    if not rotation:
        return
    day = lambda n: str(planting + timedelta(days=n - 1))  # noqa: E731
    for step in rotation["sequence"]:
        step["planting_date"] = day(step["planting_day"])
        step["earliest_harvest_date"] = day(step["earliest_harvest_day"])
        step["latest_harvest_date"] = day(step["latest_harvest_day"])
        step["phase_end_date"] = day(step["phase_end_day"])


def build_plan(body: PlanIn) -> dict:
    from nasa_final.AI import crop_rotation as planner

    ctx = forecast_context(body.latitude, body.longitude, body.planting_date)
    planting, dates = ctx["planting"], ctx["dates"]
    try:
        out = planner.plan(
            ctx["values"][30],
            ctx["values"][90] if body.planning_horizon_days == 90 else None,
            planning_horizon_days=body.planning_horizon_days,
            previous_crop=body.previous_crop,
            irrigation_available=body.irrigation_available,
            soil_ph=ctx["soil_ph"],
            translate=_both,
        )
    except ValueError as e:
        raise AppError(422, "VALIDATION_ERROR", str(e)) from e

    for phase in out["forecasts"].values():
        phase["start_date"] = str(planting + timedelta(days=phase["start_day"] - 1))
        phase["end_date"] = str(planting + timedelta(days=phase["end_day"] - 1))
    _add_dates(out["best_rotation"], planting)
    for alt in out["alternative_rotations"]:
        _add_dates(alt, planting)

    warnings = list(out["warnings"])
    warnings.insert(
        0,
        {
            "ar": f"وضع البيانات التاريخية: التوقعات محسوبة من القراءات المتوفرة حتى {ctx['origin']}، وليست توقعاً حياً للطقس الحالي.",
            "en": f"Historical data mode: forecasts are computed from readings available up to {ctx['origin']}; they are not a live forecast of current weather.",
        },
    )
    if body.cultivation_type == "greenhouse":
        warnings.append(
            {
                "ar": "التوقعات تمثل الظروف الخارجية المكشوفة، ولا تمثل الظروف داخل البيوت المحمية.",
                "en": "Forecasts describe outdoor conditions; they do not describe conditions inside a greenhouse.",
            }
        )

    return {
        "status": out["status"],  # success | partial_plan | no_plan_available
        "data_mode": ctx["mode"],  # historical_demo | historical_data
        "planning_horizon_days": out["planning_horizon_days"],
        "planting_date": str(planting),
        "forecast_origin": str(ctx["origin"]),
        "is_default_date": planting == dates["default"],
        "planting_date_min": str(dates["min"]),
        "planting_date_max": str(dates["max"]),
        "location": {
            "grid_id": ctx["grid"]["id"],
            "latitude": body.latitude,
            "longitude": body.longitude,
            "grid_distance_km": ctx["grid"]["distance_km"],
            "governorate": ctx["location"]["governorate"],
        },
        "previous_crop": body.previous_crop,
        "irrigation_available": body.irrigation_available,
        "cultivation_type": body.cultivation_type,
        "soil": ctx["soil"],
        "forecasts": out["forecasts"],
        # The two forecasts the phases are built from, with the method and validation error of each value.
        "forecast_basis": {"30": ctx["meta"][30], "90": ctx["meta"][90]},
        "best_rotation": out["best_rotation"],
        "alternative_rotations": out["alternative_rotations"],
        "rejected": out["rejected"],
        "explanation": out["explanation"],
        "warnings": warnings,
        "weights": out["weights"],
        "rule_version": out["rule_version"],
        "saved": False,
    }


@router.post("/plan", dependencies=[Depends(limit("guest", _s.rate_limit_guest))])
def plan(body: PlanIn):
    """A preliminary crop sequence for a location in Jordan. Nothing is stored."""
    return build_plan(body)


# ---------------- saved plans (signed-in users) ----------------


def _summary(p: dict) -> dict:
    best = p.get("best_rotation")
    return {
        "status": p["status"],
        "planning_horizon_days": p["planning_horizon_days"],
        "planting_date": p["planting_date"],
        "rotation_score": best["rotation_score"] if best else None,
        "crops": [s["crop_id"] for s in best["sequence"]] if best else [],
    }


def _row_out(r: RotationPlan, full: bool) -> dict:
    out = {"id": r.id, "farm_id": r.farm_id, "plot_id": r.plot_id, "plot_label": r.plot_label, "created_at": r.created_at, "summary": r.summary}
    if full:
        out["plan"] = {**r.plan, "saved": True}
    return out


def _owned_plan(session: Session, user: User, plan_id: str) -> RotationPlan:
    r = session.get(RotationPlan, plan_id)
    if not r or r.user_id != user.id:
        raise AppError(404, "NOT_FOUND", "Plan not found")
    return r


@router.post("/plans", status_code=201)
def save_plan(body: SavePlanIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    farm = owned_farm(session, user, body.farm_id)
    plot = None
    if body.plot_id:
        plot = session.get(Plot, body.plot_id)
        if not plot or plot.farm_id != farm.id:
            raise AppError(404, "NOT_FOUND", "Parcel not found")
    p = build_plan(body)
    row = RotationPlan(
        user_id=user.id,
        farm_id=farm.id,
        plot_id=plot.id if plot else None,
        plot_label=plot.label if plot else "",
        request=body.model_dump(mode="json"),
        plan=p,
        summary=_summary(p),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _row_out(row, full=True)


@router.get("/plans")
def list_plans(farm_id: str = Query(), user: User = Depends(current_user), session: Session = Depends(get_session)):
    farm = owned_farm(session, user, farm_id)
    rows = session.exec(select(RotationPlan).where(RotationPlan.farm_id == farm.id).order_by(col(RotationPlan.created_at).desc()).limit(200)).all()
    return [_row_out(r, full=False) for r in rows]


@router.get("/plans/{plan_id}")
def get_plan(plan_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    return _row_out(_owned_plan(session, user, plan_id), full=True)


@router.delete("/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    session.delete(_owned_plan(session, user, plan_id))
    session.commit()
    return Response(status_code=204)
