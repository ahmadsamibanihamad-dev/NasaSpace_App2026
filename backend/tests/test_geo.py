import pytest

from app.services.geo import geodesic_area_m2


def test_area_matches_turf_reference():
    # 0.001 x 0.001 degree square at the equator: turf.area gives ~12364 m2 with R=6378137
    poly = {"type": "Polygon", "coordinates": [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]]}
    assert geodesic_area_m2(poly) == pytest.approx(12364.0, rel=0.01)


def test_area_with_hole():
    outer = [[0, 0], [0.002, 0], [0.002, 0.002], [0, 0.002], [0, 0]]
    hole = [[0.0005, 0.0005], [0.0015, 0.0005], [0.0015, 0.0015], [0.0005, 0.0015], [0.0005, 0.0005]]
    full = geodesic_area_m2({"type": "Polygon", "coordinates": [outer]})
    holed = geodesic_area_m2({"type": "Polygon", "coordinates": [outer, hole]})
    assert holed == pytest.approx(full * 0.75, rel=0.01)
