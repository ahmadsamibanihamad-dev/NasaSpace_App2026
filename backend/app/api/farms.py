"""Farms, parcels and crop history. Everything here belongs to the signed-in user."""

from fastapi import APIRouter, Depends, Response
from sqlmodel import Session, col, select

from app.api.deps import current_user, owned_farm, owned_plot
from app.api.schemas import FarmIn, FarmOut, FarmUpdateIn, HistoryItem, HistoryReplaceIn, PlotIn, PlotOut, PlotUpdateIn
from app.core.db import get_session
from app.core.errors import AppError
from app.models import Analysis, CropHistory, Farm, Plot, User, utcnow
from app.services.crops import CROP_IDS
from app.services.geo import geodesic_area_m2, governorate_for, governorate_info, perimeter_m, require_in_jordan, to_geojson, validate_parcel

router = APIRouter(tags=["farms"])


# ---------------- helpers ----------------


def farm_out(session: Session, f: Farm) -> FarmOut:
    plots = session.exec(select(Plot.area_m2).where(Plot.farm_id == f.id)).all()
    return FarmOut(
        id=f.id,
        user_id=f.user_id,
        name=f.name,
        governorate=governorate_info(f.governorate_id),
        centroid={"lat": f.centroid_lat, "lon": f.centroid_lon},
        owner_name=f.owner_name,
        owner_phone=f.owner_phone,
        is_demo=f.is_demo,
        plots_count=len(plots),
        area_m2=round(sum(plots), 1),
        created_at=f.created_at,
    )


def latest_plot_scores(session: Session, farm_id: str) -> dict[str, dict]:
    """Latest suitability score and top risk per parcel, from the user's completed analyses."""
    rows = session.exec(
        select(Analysis)
        .where(Analysis.farm_id == farm_id, Analysis.status == "completed", col(Analysis.analysis_type).in_(["crop_suitability", "risk"]))
        .order_by(col(Analysis.created_at).desc())
        .limit(30)
    ).all()
    rank = {"high": 3, "moderate": 2, "low": 1}
    out: dict[str, dict] = {}
    for a in rows:
        for p in (a.result or {}).get("plots") or []:
            d = out.setdefault(p["plot_id"], {})
            if "score" not in d and p.get("suitability_score") is not None:
                d["score"] = p["suitability_score"]
                d["status"] = p.get("suitability_status")
            if "risk" not in d and p.get("risks"):
                top = max(p["risks"], key=lambda r: rank.get(r.get("severity"), 0))
                d["risk"] = {"type": top["type"], "severity": top["severity"]}
    return out


def plot_out(p: Plot, scores: dict | None = None) -> PlotOut:
    s = (scores or {}).get(p.id, {})
    return PlotOut(
        **p.model_dump(exclude={"area_m2", "perimeter_m"}),
        area_m2=round(p.area_m2, 1),
        perimeter_m=round(p.perimeter_m, 1),
        latest_score=s.get("score"),
        latest_status=s.get("status"),
        latest_top_risk=s.get("risk"),
    )


def _check_crop(cid: str | None) -> None:
    if cid is not None and cid not in CROP_IDS:
        raise AppError(422, "UNSUPPORTED_CROP", f"Unsupported crop '{cid}'", {"supported": sorted(CROP_IDS)})


def _check_label(session: Session, farm_id: str, label: str, self_id: str | None = None) -> None:
    clash = session.exec(select(Plot).where(Plot.farm_id == farm_id, Plot.label == label)).first()
    if clash and clash.id != self_id:
        raise AppError(409, "DUPLICATE_LABEL", "Parcel number already used in this farm")


def _apply_polygon(p: Plot, polygon: dict) -> None:
    g = validate_parcel(polygon)
    p.polygon = to_geojson(g)
    p.area_m2 = geodesic_area_m2(g)
    p.perimeter_m = perimeter_m(g)


def recenter_farm(session: Session, farm: Farm) -> None:
    """Keep the farm centre and governorate in step with its parcels (used for climate data)."""
    from shapely.geometry import shape

    plots = session.exec(select(Plot).where(Plot.farm_id == farm.id)).all()
    if not plots:
        return
    cs = [shape(p.polygon).centroid for p in plots]
    lat = sum(c.y for c in cs) / len(cs)
    lon = sum(c.x for c in cs) / len(cs)
    farm.centroid_lat, farm.centroid_lon = round(lat, 6), round(lon, 6)
    gov = governorate_for(lat, lon)
    if gov:
        farm.governorate_id = gov["id"]
    session.add(farm)


def _sort_key(p: Plot):
    digits = "".join(ch for ch in p.label if ch.isdigit())
    return ("".join(ch for ch in p.label if not ch.isdigit()), int(digits) if digits else 0, p.label)


def next_label(session: Session, farm_id: str) -> str:
    nums = [int(p) for p in session.exec(select(Plot.label).where(Plot.farm_id == farm_id)).all() if p.isdigit()]
    return str(max(nums, default=0) + 1)


# ---------------- farms ----------------


@router.get("/farms", response_model=list[FarmOut])
def list_farms(user: User = Depends(current_user), session: Session = Depends(get_session)):
    farms = session.exec(select(Farm).where(Farm.user_id == user.id).order_by(col(Farm.created_at))).all()
    return [farm_out(session, f) for f in farms]


@router.post("/farms", response_model=FarmOut, status_code=201)
def create_farm(body: FarmIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    require_in_jordan(body.lat, body.lon)
    gov = governorate_for(body.lat, body.lon)
    f = Farm(
        user_id=user.id, name=body.name.strip(), governorate_id=gov["id"] if gov else None,
        centroid_lat=round(body.lat, 6), centroid_lon=round(body.lon, 6),
        owner_name=body.owner_name.strip(), owner_phone=body.owner_phone.strip(),
    )
    session.add(f)
    session.commit()
    session.refresh(f)
    return farm_out(session, f)


@router.post("/farms/demo", response_model=FarmOut, status_code=201)
def create_demo_farm(user: User = Depends(current_user), session: Session = Depends(get_session)):
    """Creates the clearly-flagged demo farm (is_demo) with six parcels and crop history."""
    from app.services.demo import create_demo_farm as build

    return farm_out(session, build(session, user))


@router.get("/farms/{farm_id}", response_model=FarmOut)
def get_farm(farm_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    return farm_out(session, owned_farm(session, user, farm_id))


@router.patch("/farms/{farm_id}", response_model=FarmOut)
def update_farm(farm_id: str, body: FarmUpdateIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    f = owned_farm(session, user, farm_id)
    for k, val in body.model_dump(exclude_unset=True).items():
        if val is not None:
            setattr(f, k, val.strip())
    session.add(f)
    session.commit()
    session.refresh(f)
    return farm_out(session, f)


@router.delete("/farms/{farm_id}", status_code=204)
def delete_farm(farm_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    f = owned_farm(session, user, farm_id)
    # Children first, flushed in order: the models declare no ORM relationships, so the session
    # would otherwise be free to delete the farm row before the rows that point at it.
    plots = session.exec(select(Plot).where(Plot.farm_id == f.id)).all()
    for a in session.exec(select(Analysis).where(Analysis.farm_id == f.id)).all():
        session.delete(a)
    for p in plots:
        for h in session.exec(select(CropHistory).where(CropHistory.plot_id == p.id)).all():
            session.delete(h)
    session.flush()
    for p in plots:
        session.delete(p)
    session.flush()
    session.delete(f)
    session.commit()
    return Response(status_code=204)


# ---------------- parcels ----------------


@router.get("/farms/{farm_id}/plots", response_model=list[PlotOut])
def list_plots(farm_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    f = owned_farm(session, user, farm_id)
    plots = session.exec(select(Plot).where(Plot.farm_id == f.id)).all()
    scores = latest_plot_scores(session, f.id)
    return [plot_out(p, scores) for p in sorted(plots, key=_sort_key)]


@router.get("/farms/{farm_id}/plots/next-label")
def get_next_label(farm_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    f = owned_farm(session, user, farm_id)
    return {"label": next_label(session, f.id)}


@router.post("/farms/{farm_id}/plots", response_model=PlotOut, status_code=201)
def create_plot(farm_id: str, body: PlotIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    f = owned_farm(session, user, farm_id)
    _check_crop(body.current_crop_id)
    _check_crop(body.previous_crop_id)
    label = body.label.strip()
    _check_label(session, f.id, label)
    data = body.model_dump(exclude={"polygon", "label", "name"})
    if not data["irrigation_available"]:
        data["irrigation_method"] = "none"
    p = Plot(farm_id=f.id, label=label, name=body.name.strip(), polygon={}, area_m2=0, **data)
    _apply_polygon(p, body.polygon)
    session.add(p)
    session.flush()
    recenter_farm(session, f)
    session.commit()
    session.refresh(p)
    return plot_out(p)


@router.get("/plots/{plot_id}", response_model=PlotOut)
def get_plot(plot_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    p = owned_plot(session, user, plot_id)
    return plot_out(p, latest_plot_scores(session, p.farm_id))


@router.patch("/plots/{plot_id}", response_model=PlotOut)
def update_plot(plot_id: str, body: PlotUpdateIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    p = owned_plot(session, user, plot_id)
    data = body.model_dump(exclude_unset=True)
    for key in ("current_crop_id", "previous_crop_id"):
        if key in data:
            _check_crop(data[key])
    if data.get("label") is not None:
        data["label"] = data["label"].strip()
        _check_label(session, p.farm_id, data["label"], p.id)
    polygon = data.pop("polygon", None)
    required = {"label", "name", "color", "status", "irrigation_available", "cultivation_type", "region", "notes", "owner_name", "owner_phone"}
    for k, val in data.items():
        if val is None and k in required:
            continue  # these cannot be cleared
        setattr(p, k, val.strip() if isinstance(val, str) and k in ("name", "region", "owner_name", "owner_phone") else val)
    if not p.irrigation_available:
        p.irrigation_method = "none"
    if polygon is not None:
        _apply_polygon(p, polygon)
    p.updated_at = utcnow()
    session.add(p)
    if polygon is not None:
        session.flush()
        recenter_farm(session, session.get(Farm, p.farm_id))
    session.commit()
    session.refresh(p)
    return plot_out(p, latest_plot_scores(session, p.farm_id))


@router.delete("/plots/{plot_id}", status_code=204)
def delete_plot(plot_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    p = owned_plot(session, user, plot_id)
    farm = session.get(Farm, p.farm_id)
    for h in session.exec(select(CropHistory).where(CropHistory.plot_id == p.id)).all():
        session.delete(h)
    session.flush()  # history rows before the parcel they point at
    session.delete(p)
    session.flush()
    recenter_farm(session, farm)
    session.commit()
    return Response(status_code=204)


# ---------------- crop history ----------------


def _history(session: Session, plot_id: str) -> list[HistoryItem]:
    rows = session.exec(select(CropHistory).where(CropHistory.plot_id == plot_id)).all()
    return [HistoryItem(id=h.id, season=h.season, crop_id=h.crop_id) for h in sorted(rows, key=lambda h: h.season)]


@router.get("/plots/{plot_id}/history", response_model=list[HistoryItem])
def get_history(plot_id: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    return _history(session, owned_plot(session, user, plot_id).id)


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
    session.flush()
    for i in body.items:
        session.add(CropHistory(plot_id=p.id, season=i.season, crop_id=i.crop_id))
    session.commit()
    return _history(session, p.id)
