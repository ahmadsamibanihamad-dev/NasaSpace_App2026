from fastapi import APIRouter, Depends, Response
from shapely.geometry import shape
from sqlmodel import Session, col, select

from app.api.deps import current_user, owned_farm, owned_plot
from app.api.schemas import (
    FarmIn,
    FarmOut,
    FarmUpdateIn,
    HistoryItem,
    HistoryReplaceIn,
    PlotDetailsBulkIn,
    PlotOut,
    PlotsReplaceIn,
    PlotUpdateIn,
)
from app.core.db import get_session
from app.core.errors import AppError
from app.models import Analysis, CropHistory, Farm, Plot, User
from app.services.crops import CROP_IDS
from app.services.geo import (
    geodesic_area_m2,
    governorate_for,
    governorate_info,
    parse_polygon,
    require_polygon_in_jordan,
    to_geojson,
)

router = APIRouter(tags=["farms"])

MIN_PLOT_M2 = 250.0  # 0.25 dunum
MIN_FARM_M2 = 250.0
MAX_FARM_M2 = 50_000_000.0  # 50 km², sanity limit


def farm_out(session: Session, f: Farm) -> FarmOut:
    n = len(session.exec(select(Plot.id).where(Plot.farm_id == f.id)).all())
    return FarmOut(
        id=f.id,
        name=f.name,
        governorate=governorate_info(f.governorate_id),
        boundary=f.boundary,
        area_m2=round(f.area_m2, 1),
        centroid={"lat": f.centroid_lat, "lon": f.centroid_lon},
        plots_count=n,
        is_demo=f.is_demo,
        plot_layout=f.plot_layout,
        created_at=f.created_at,
    )


def latest_plot_scores(session: Session, farm_id: str) -> dict[str, dict]:
    """Latest suitability score and top risk per plot, from completed analyses."""
    rows = session.exec(
        select(Analysis)
        .where(Analysis.farm_id == farm_id, Analysis.status == "completed", col(Analysis.analysis_type).in_(["crop_suitability", "risk"]))
        .order_by(col(Analysis.created_at).desc())
        .limit(30)
    ).all()
    out: dict[str, dict] = {}
    sev_rank = {"high": 3, "moderate": 2, "low": 1}
    for a in rows:
        for p in (a.result or {}).get("plots", []) or []:
            d = out.setdefault(p["plot_id"], {})
            if "score" not in d and p.get("suitability_score") is not None:
                d["score"] = p["suitability_score"]
                d["status"] = p.get("suitability_status")
            if "risk" not in d and p.get("risks"):
                top = max(p["risks"], key=lambda r: sev_rank.get(r.get("severity"), 0))
                d["risk"] = {"type": top["type"], "severity": top["severity"]}
    return out


def plot_out(p: Plot, scores: dict | None = None) -> PlotOut:
    s = (scores or {}).get(p.id, {})
    return PlotOut(
        id=p.id,
        farm_id=p.farm_id,
        label=p.label,
        name=p.name,
        polygon=p.polygon,
        area_m2=round(p.area_m2, 1),
        excluded=p.excluded,
        exclusion_reason=p.exclusion_reason,
        current_crop_id=p.current_crop_id,
        previous_crop_id=p.previous_crop_id,
        irrigation_available=p.irrigation_available,
        irrigation_method=p.irrigation_method,
        soil_type=p.soil_type,
        soil_ph=p.soil_ph,
        latest_score=s.get("score"),
        latest_status=s.get("status"),
        latest_top_risk=s.get("risk"),
    )


def _check_crop(cid: str | None) -> None:
    if cid is not None and cid not in CROP_IDS:
        raise AppError(422, "UNSUPPORTED_CROP", f"Unsupported crop '{cid}'", {"supported": sorted(CROP_IDS)})


def _apply_boundary(f: Farm, boundary: dict) -> None:
    g = parse_polygon(boundary)
    require_polygon_in_jordan(g)
    area = geodesic_area_m2(g)
    if area < MIN_FARM_M2:
        raise AppError(422, "VALIDATION_ERROR", "Farm area is too small (minimum 0.25 dunum)")
    if area > MAX_FARM_M2:
        raise AppError(422, "VALIDATION_ERROR", "Farm area is too large")
    c = g.centroid
    f.boundary = to_geojson(g)
    f.area_m2 = area
    f.centroid_lat = round(c.y, 6)
    f.centroid_lon = round(c.x, 6)
    gov = governorate_for(c.y, c.x)
    f.governorate_id = gov["id"] if gov else None


# ---------------- Farms ----------------


@router.get("/farms", response_model=list[FarmOut])
def list_farms(user: User = Depends(current_user), session: Session = Depends(get_session)):
    farms = session.exec(select(Farm).where(Farm.user_id == user.id).order_by(col(Farm.created_at))).all()
    return [farm_out(session, f) for f in farms]


@router.post("/farms", response_model=FarmOut, status_code=201)
def create_farm(body: FarmIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    f = Farm(user_id=user.id, name=body.name.strip(), boundary={}, area_m2=0, centroid_lat=0, centroid_lon=0)
    _apply_boundary(f, body.boundary)
    session.add(f)
    session.commit()
    session.refresh(f)
    return farm_out(session, f)


@router.get("/farms/{farm_id}", response_model=FarmOut)
def get_farm(farm_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    return farm_out(session, owned_farm(session, user, farm_id))


@router.patch("/farms/{farm_id}", response_model=FarmOut)
def update_farm(farm_id: str, body: FarmUpdateIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    f = owned_farm(session, user, farm_id)
    if body.name is not None:
        f.name = body.name.strip()
    if body.boundary is not None:
        _apply_boundary(f, body.boundary)
        f.plot_layout = None
    session.add(f)
    session.commit()
    session.refresh(f)
    return farm_out(session, f)


@router.delete("/farms/{farm_id}", status_code=204)
def delete_farm(farm_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    f = owned_farm(session, user, farm_id)
    for a in session.exec(select(Analysis).where(Analysis.farm_id == f.id)).all():
        session.delete(a)
    for p in session.exec(select(Plot).where(Plot.farm_id == f.id)).all():
        for h in session.exec(select(CropHistory).where(CropHistory.plot_id == p.id)).all():
            session.delete(h)
        session.delete(p)
    session.delete(f)
    session.commit()
    return Response(status_code=204)


# ---------------- Plots ----------------


@router.get("/farms/{farm_id}/plots", response_model=list[PlotOut])
def list_plots(farm_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    f = owned_farm(session, user, farm_id)
    plots = session.exec(select(Plot).where(Plot.farm_id == f.id)).all()
    scores = latest_plot_scores(session, f.id)
    return [plot_out(p, scores) for p in sorted(plots, key=lambda p: (p.label[:1], int("".join(c for c in p.label if c.isdigit()) or 0)))]


@router.put("/farms/{farm_id}/plots", response_model=list[PlotOut])
def replace_plots(farm_id: str, body: PlotsReplaceIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    """Bulk replace from the plot editor. Plots keep their id, details and history when the label is unchanged."""
    f = owned_farm(session, user, farm_id)
    boundary = shape(f.boundary).buffer(0)
    tol = max(boundary.area * 0.02, 1e-12)
    parsed = []
    union_area = 0.0
    too_small = []
    for item in body.plots:
        g = parse_polygon(item.polygon, allow_multi=True)
        outside = g.difference(boundary).area
        if outside > max(g.area * 0.05, tol * 0.1):
            raise AppError(422, "PLOT_OUTSIDE_FARM", f"Plot {item.label} extends outside the farm boundary", {"label": item.label})
        g = g.intersection(boundary)
        area = geodesic_area_m2(g)
        if not item.excluded and area < MIN_PLOT_M2:
            too_small.append(item.label)
        union_area += g.area
        parsed.append((item, g, area))
    if too_small:
        raise AppError(422, "PLOT_TOO_SMALL", "Plots must be at least 0.25 dunum", {"labels": too_small})
    if union_area > boundary.area * 1.03:
        raise AppError(422, "PLOTS_OVERLAP", "Plots overlap each other")

    f.plot_layout = body.layout
    session.add(f)
    existing = {p.label: p for p in session.exec(select(Plot).where(Plot.farm_id == f.id)).all()}
    keep = set()
    for item, g, area in parsed:
        p = existing.get(item.label)
        if p is None:
            p = Plot(farm_id=f.id, label=item.label, polygon={}, area_m2=0)
        p.name = item.name or item.label
        p.polygon = to_geojson(g)
        p.area_m2 = area
        p.excluded = item.excluded
        p.exclusion_reason = item.exclusion_reason if item.excluded else None
        session.add(p)
        keep.add(item.label)
    for label, p in existing.items():
        if label not in keep:
            for h in session.exec(select(CropHistory).where(CropHistory.plot_id == p.id)).all():
                session.delete(h)
            session.delete(p)
    session.commit()
    return list_plots(farm_id, user, session)


@router.patch("/farms/{farm_id}/plots/details", response_model=list[PlotOut])
def update_plot_details(farm_id: str, body: PlotDetailsBulkIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    f = owned_farm(session, user, farm_id)
    plots = {p.id: p for p in session.exec(select(Plot).where(Plot.farm_id == f.id)).all()}
    for it in body.items:
        p = plots.get(it.id)
        if not p:
            raise AppError(404, "NOT_FOUND", f"Plot {it.id} not found in this farm")
        _check_crop(it.current_crop_id)
        _check_crop(it.previous_crop_id)
        p.current_crop_id = it.current_crop_id
        p.previous_crop_id = it.previous_crop_id
        p.irrigation_available = it.irrigation_available
        p.irrigation_method = it.irrigation_method if it.irrigation_available else "none"
        p.soil_type = it.soil_type
        p.soil_ph = it.soil_ph
        session.add(p)
    session.commit()
    return list_plots(farm_id, user, session)


@router.get("/plots/{plot_id}", response_model=PlotOut)
def get_plot(plot_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    p = owned_plot(session, user, plot_id)
    return plot_out(p, latest_plot_scores(session, p.farm_id))


@router.patch("/plots/{plot_id}", response_model=PlotOut)
def update_plot(plot_id: str, body: PlotUpdateIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    p = owned_plot(session, user, plot_id)
    data = body.model_dump(exclude_unset=True)
    _check_crop(data.get("current_crop_id"))
    _check_crop(data.get("previous_crop_id"))
    for k, v in data.items():
        setattr(p, k, v)
    session.add(p)
    session.commit()
    session.refresh(p)
    return plot_out(p, latest_plot_scores(session, p.farm_id))


# ---------------- Crop history ----------------


@router.get("/plots/{plot_id}/history", response_model=list[HistoryItem])
def get_history(plot_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    p = owned_plot(session, user, plot_id)
    rows = session.exec(select(CropHistory).where(CropHistory.plot_id == p.id)).all()
    return [HistoryItem(id=h.id, season=h.season, crop_id=h.crop_id) for h in sorted(rows, key=lambda h: h.season)]


@router.put("/plots/{plot_id}/history", response_model=list[HistoryItem])
def replace_history(plot_id: str, body: HistoryReplaceIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    p = owned_plot(session, user, plot_id)
    seasons = [i.season for i in body.items]
    if len(set(seasons)) != len(seasons):
        raise AppError(422, "VALIDATION_ERROR", "Each season can appear only once")
    for i in body.items:
        _check_crop(i.crop_id)
    for h in session.exec(select(CropHistory).where(CropHistory.plot_id == p.id)).all():
        session.delete(h)
    for i in body.items:
        session.add(CropHistory(plot_id=p.id, season=i.season, crop_id=i.crop_id))
    session.commit()
    return get_history(plot_id, user, session)


@router.post("/plots/{plot_id}/history", response_model=HistoryItem, status_code=201)
def add_history(plot_id: str, body: HistoryItem, user: User = Depends(current_user), session: Session = Depends(get_session)):
    p = owned_plot(session, user, plot_id)
    _check_crop(body.crop_id)
    if session.exec(select(CropHistory).where(CropHistory.plot_id == p.id, CropHistory.season == body.season)).first():
        raise AppError(409, "CONFLICT", "Season already recorded")
    h = CropHistory(plot_id=p.id, season=body.season, crop_id=body.crop_id)
    session.add(h)
    session.commit()
    return HistoryItem(id=h.id, season=h.season, crop_id=h.crop_id)


@router.delete("/plots/{plot_id}/history/{item_id}", status_code=204)
def delete_history(plot_id: str, item_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    p = owned_plot(session, user, plot_id)
    h = session.get(CropHistory, item_id)
    if not h or h.plot_id != p.id:
        raise AppError(404, "NOT_FOUND", "History item not found")
    session.delete(h)
    session.commit()
    return Response(status_code=204)
