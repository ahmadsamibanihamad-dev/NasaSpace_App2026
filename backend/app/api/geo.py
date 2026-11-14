from fastapi import APIRouter, Query

from app.api.schemas import LocateOut
from app.services.geo import governorate_for, inside_jordan

router = APIRouter(prefix="/geo", tags=["geo"])


@router.get("/locate", response_model=LocateOut)
def locate(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)):
    inside = inside_jordan(lat, lon)
    return LocateOut(lat=lat, lon=lon, inside_jordan=inside, governorate=governorate_for(lat, lon) if inside else None)
