"""Jordan-only geometry: boundary checks, governorate lookup (local point-in-polygon), areas.

Boundaries: geoBoundaries gbOpen (JOR ADM0 CC BY 4.0, ADM1 CC BY 2.5), simplified.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache

from shapely.geometry import Point, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.validation import make_valid

from app.core.config import DATA_DIR
from app.core.errors import AppError

GEO_DIR = DATA_DIR / "geo"
EARTH_RADIUS = 6378137.0  # same constant as Turf.js, so areas match the frontend


@lru_cache
def _jordan():
    gj = json.loads((GEO_DIR / "jordan.geojson").read_text(encoding="utf-8"))
    geom = unary_union([shape(f["geometry"]) for f in gj["features"]])
    return geom, prep(geom.buffer(0))


@lru_cache
def _governorates():
    gj = json.loads((GEO_DIR / "governorates.geojson").read_text(encoding="utf-8"))
    out = []
    for f in gj["features"]:
        g = make_valid(shape(f["geometry"]))
        out.append((f["properties"], g, prep(g)))
    return out


def governorate_info(gov_id: str | None) -> dict | None:
    if not gov_id:
        return None
    for props, _, _ in _governorates():
        if props["id"] == gov_id:
            return {"id": props["id"], "name_ar": props["name_ar"], "name_en": props["name_en"]}
    return None


def inside_jordan(lat: float, lon: float) -> bool:
    _, prepared = _jordan()
    return prepared.covers(Point(lon, lat))


def governorate_for(lat: float, lon: float) -> dict | None:
    """Local point-in-polygon. ADM0 and ADM1 sources differ slightly at the edges,
    so a point inside Jordan but between governorate polygons gets the nearest one."""
    p = Point(lon, lat)
    for props, _, prepared in _governorates():
        if prepared.covers(p):
            return governorate_info(props["id"])
    if inside_jordan(lat, lon):
        nearest = min(_governorates(), key=lambda t: t[1].distance(p))
        return governorate_info(nearest[0]["id"])
    return None


def require_in_jordan(lat: float, lon: float) -> None:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or not inside_jordan(lat, lon):
        raise AppError(422, "UNSUPPORTED_LOCATION", "Location is outside Jordan. Only farms in Jordan are supported.", {"lat": lat, "lon": lon})


def _ring_area(coords) -> float:
    """Spherical ring area (Chamberlain & Duquette), identical to @turf/area."""
    n = len(coords)
    if n <= 2:
        return 0.0
    total = 0.0
    for i in range(n):
        if i == n - 2:
            lower, middle, upper = n - 2, n - 1, 0
        elif i == n - 1:
            lower, middle, upper = n - 1, 0, 1
        else:
            lower, middle, upper = i, i + 1, i + 2
        p1, p2, p3 = coords[lower], coords[middle], coords[upper]
        total += (math.radians(p3[0]) - math.radians(p1[0])) * math.sin(math.radians(p2[1]))
    return abs(total * EARTH_RADIUS * EARTH_RADIUS / 2)


def geodesic_area_m2(geom: BaseGeometry | dict) -> float:
    g = shape(geom) if isinstance(geom, dict) else geom
    if g.is_empty:
        return 0.0
    polys = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
    area = 0.0
    for p in polys:
        if p.geom_type != "Polygon":
            continue
        area += _ring_area(list(p.exterior.coords))
        for interior in p.interiors:
            area -= _ring_area(list(interior.coords))
    return area


def parse_polygon(gj: dict, *, allow_multi: bool = False) -> BaseGeometry:
    try:
        g = shape(gj)
    except Exception as exc:  # noqa: BLE001
        raise AppError(422, "INVALID_GEOMETRY", f"Invalid GeoJSON geometry: {exc}") from exc
    allowed = ("Polygon", "MultiPolygon") if allow_multi else ("Polygon",)
    if g.geom_type not in allowed:
        raise AppError(422, "INVALID_GEOMETRY", f"Geometry must be {' or '.join(allowed)}")
    if not g.is_valid:
        g = make_valid(g)
        polys = [x for x in getattr(g, "geoms", [g]) if x.geom_type in ("Polygon", "MultiPolygon")]
        if not polys:
            raise AppError(422, "INVALID_GEOMETRY", "Polygon is self-intersecting")
        g = unary_union(polys)
        if g.geom_type == "MultiPolygon" and not allow_multi:
            g = max(g.geoms, key=lambda x: x.area)
    return g


def require_polygon_in_jordan(g: BaseGeometry) -> None:
    jordan, _ = _jordan()
    for x, y in (g.exterior.coords if g.geom_type == "Polygon" else [c for p in g.geoms for c in p.exterior.coords]):
        require_in_jordan(y, x)
    # tolerate tiny slivers due to boundary simplification
    if g.difference(jordan).area > g.area * 0.01:
        raise AppError(422, "UNSUPPORTED_LOCATION", "Part of the polygon is outside Jordan.")


def to_geojson(g: BaseGeometry) -> dict:
    return json.loads(json.dumps(mapping(g)))
