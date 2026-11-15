"""Saved analyses for signed-in users: the user's history."""

import logging
from datetime import timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Response
from sqlmodel import Session, col, select

from app.api.deps import current_user, owned_farm
from app.api.schemas import AnalysisCreated, AnalysisIn, AnalysisOut, AnalysisType
from app.core.db import get_engine, get_session
from app.core.errors import AppError
from app.engine.run import STAGES, run_analysis, summarize
from app.models import Analysis, CropHistory, Farm, Plot, User, utcnow
from app.services.climate import get_climate
from app.services.crops import CROP_IDS

router = APIRouter(prefix="/analyses", tags=["analyses"])
log = logging.getLogger("ardna.analyses")
MAX_SAVED_PER_FARM = 60


def analysis_out(a: Analysis, with_result: bool = True) -> AnalysisOut:
    done = a.status == "completed"
    idx = len(STAGES) if done else (STAGES.index(a.stage) if a.stage in STAGES else -1)
    stages = [
        {"key": key, "label": {"ar": "", "en": ""}, "status": "done" if done or i < idx else "running" if i == idx and a.status == "running" else "pending"}
        for i, key in enumerate(STAGES)
    ]
    return AnalysisOut(
        id=a.id, farm_id=a.farm_id, analysis_type=a.analysis_type, scope=a.scope, inputs=a.inputs, status=a.status, stage=a.stage,
        stages=stages, result=a.result if with_result else None, error=a.error,
        created_at=a.created_at if a.created_at.tzinfo else a.created_at.replace(tzinfo=timezone.utc),
        completed_at=a.completed_at, summary=a.summary,
    )


def execute(analysis_id: str) -> None:
    """Background job: updates status and stage as the real steps happen."""
    with Session(get_engine()) as session:
        a = session.get(Analysis, analysis_id)
        if a is None:
            return

        def stage(name: str) -> None:
            a.status, a.stage = "running", name
            session.add(a)
            session.commit()

        try:
            farm = session.get(Farm, a.farm_id)
            ids = a.inputs.get("plot_ids")
            plots = session.exec(select(Plot).where(Plot.farm_id == farm.id)).all()
            if ids:
                plots = [p for p in plots if p.id in ids]
            plots.sort(key=lambda p: (len(p.label), p.label))
            history = {
                p.id: [{"season": h.season, "crop_id": h.crop_id} for h in sorted(session.exec(select(CropHistory).where(CropHistory.plot_id == p.id)).all(), key=lambda h: h.season)]
                for p in plots
            }
            stage(STAGES[0])
            climate = get_climate(session, farm.centroid_lat, farm.centroid_lon)
            result = run_analysis(
                climate, farm, plots, history, a.analysis_type,
                crop_id=a.inputs.get("crop_id"), planting_date=a.inputs.get("planting_date"), priority=a.inputs.get("priority"), on_stage=stage,
            )
            a.result = result
            a.summary = summarize(result, a.inputs.get("crop_id"), [p.label for p in plots])
            a.status, a.stage, a.completed_at = "completed", None, utcnow()
        except AppError as exc:
            a.status, a.error = "failed", {"code": exc.code, "message": exc.message}
        except Exception:  # noqa: BLE001
            log.exception("Analysis %s failed", analysis_id)
            a.status, a.error = "failed", {"code": "ANALYSIS_FAILED", "message": "The analysis could not be completed"}
        session.add(a)
        session.commit()


@router.post("", response_model=AnalysisCreated, status_code=202)
def create_analysis(body: AnalysisIn, background: BackgroundTasks, user: User = Depends(current_user), session: Session = Depends(get_session)):
    farm = owned_farm(session, user, body.farm_id)
    if body.crop_id is not None and body.crop_id not in CROP_IDS:
        raise AppError(422, "UNSUPPORTED_CROP", f"Unsupported crop '{body.crop_id}'", {"supported": sorted(CROP_IDS)})
    if body.analysis_type == "crop_suitability" and not body.crop_id:
        raise AppError(422, "VALIDATION_ERROR", "crop_id is required for a crop suitability analysis")
    plots = session.exec(select(Plot).where(Plot.farm_id == farm.id)).all()
    if body.plot_ids is not None:
        known = {p.id for p in plots}
        if not body.plot_ids or any(i not in known for i in body.plot_ids):
            raise AppError(422, "VALIDATION_ERROR", "plot_ids must be parcels of this farm")
        plots = [p for p in plots if p.id in body.plot_ids]
    if not plots:
        raise AppError(422, "VALIDATION_ERROR", "The farm has no parcels to analyse")
    a = Analysis(
        user_id=user.id, farm_id=farm.id, analysis_type=body.analysis_type, scope="plots" if body.plot_ids else "farm",
        inputs=body.model_dump(), summary={"headline_score": None, "crop": body.crop_id, "plots": sorted(p.label for p in plots)},
    )
    session.add(a)
    # keep the history bounded per farm
    old = session.exec(select(Analysis).where(Analysis.farm_id == farm.id).order_by(col(Analysis.created_at).desc()).offset(MAX_SAVED_PER_FARM)).all()
    for o in old:
        session.delete(o)
    session.commit()
    background.add_task(execute, a.id)
    return AnalysisCreated(analysis_id=a.id, status=a.status)


@router.get("", response_model=list[AnalysisOut])
def list_analyses(farm_id: str = Query(), analysis_type: AnalysisType | None = None, user: User = Depends(current_user), session: Session = Depends(get_session)):
    farm = owned_farm(session, user, farm_id)
    q = select(Analysis).where(Analysis.farm_id == farm.id)
    if analysis_type:
        q = q.where(Analysis.analysis_type == analysis_type)
    rows = session.exec(q.order_by(col(Analysis.created_at).desc()).limit(200)).all()
    return [analysis_out(a, with_result=False) for a in rows]


def _owned(session: Session, user: User, analysis_id: str) -> Analysis:
    a = session.get(Analysis, analysis_id)
    if not a or a.user_id != user.id:
        raise AppError(404, "NOT_FOUND", "Analysis not found")
    return a


@router.get("/{analysis_id}", response_model=AnalysisOut)
def get_analysis(analysis_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    return analysis_out(_owned(session, user, analysis_id))


@router.delete("/{analysis_id}", status_code=204)
def delete_analysis(analysis_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    session.delete(_owned(session, user, analysis_id))
    session.commit()
    return Response(status_code=204)


def fail_interrupted(session: Session) -> int:
    """On startup: analyses left running by a previous process can never finish."""
    rows = session.exec(select(Analysis).where(col(Analysis.status).in_(["queued", "running"]))).all()
    for a in rows:
        a.status, a.error = "failed", {"code": "INTERRUPTED", "message": "The analysis was interrupted by a server restart"}
        session.add(a)
    session.commit()
    return len(rows)
