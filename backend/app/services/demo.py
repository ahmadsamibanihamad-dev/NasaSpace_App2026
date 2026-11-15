"""Demo farm: مزرعة الحصن, Irbid, about 25 dunum, six parcels with crop history. Always flagged is_demo."""

from sqlmodel import Session

from app.models import CropHistory, Farm, Plot, User
from app.services.geo import geodesic_area_m2, governorate_for, perimeter_m

LAT, LON = 32.5568, 35.8469
CELL_LAT = 0.000535  # about 59.5 m north-south
CELL_LON = 0.000746  # about 70 m east-west at this latitude
COLORS = ["#2F8F4E", "#7FC190", "#134324", "#2F7FD1", "#E8892B", "#D64533"]
SEASONS = ["2023-2024", "2024-2025", "2025-2026"]
PLOTS = [
    ("A1", "wheat", ["wheat", "lentil", "wheat"], False),
    ("A2", "wheat", ["barley", "wheat", "wheat"], False),
    ("A3", "barley", ["chickpea", "wheat", "barley"], False),
    ("B1", "lentil", ["wheat", "barley", "lentil"], False),
    ("B2", None, ["wheat", None, None], False),
    ("B3", "tomato", ["cucumber", "tomato", "tomato"], True),
]


def _cell(row: int, col: int) -> dict:
    n = LAT + CELL_LAT * (1 - row)
    s = n - CELL_LAT
    w = LON + CELL_LON * (col - 1.5)
    e = w + CELL_LON
    r = lambda x: round(x, 6)  # noqa: E731
    return {"type": "Polygon", "coordinates": [[[r(w), r(s)], [r(e), r(s)], [r(e), r(n)], [r(w), r(n)], [r(w), r(s)]]]}


def create_demo_farm(session: Session, user: User) -> Farm:
    gov = governorate_for(LAT, LON)
    farm = Farm(user_id=user.id, name="مزرعة الحصن", governorate_id=gov["id"] if gov else None, centroid_lat=LAT, centroid_lon=LON, is_demo=True)
    session.add(farm)
    session.flush()
    for i, (label, crop, history, irrigated) in enumerate(PLOTS):
        poly = _cell(i // 3, i % 3)
        plot = Plot(
            farm_id=farm.id, label=label, name=f"قطعة {label}", region="الحصن", polygon=poly,
            area_m2=geodesic_area_m2(poly), perimeter_m=perimeter_m(poly), color=COLORS[i % len(COLORS)],
            status="planted" if crop else "fallow", notes="بيانات تجريبية", current_crop_id=crop, previous_crop_id=history[1],
            irrigation_available=irrigated, irrigation_method="drip" if irrigated else "none",
        )
        session.add(plot)
        session.flush()
        for season, c in zip(SEASONS, history):
            session.add(CropHistory(plot_id=plot.id, season=season, crop_id=c))
    session.commit()
    session.refresh(farm)
    return farm
