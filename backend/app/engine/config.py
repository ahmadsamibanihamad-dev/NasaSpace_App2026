"""Rule-engine configuration and crop knowledge base (loaded from app/data/*.json).

engine_config.json holds weights, thresholds and penalties. They are engineering defaults,
not values from FAO/ECOCROP: all are needs_review and can be tuned without touching code.
"""

from __future__ import annotations

import json
from functools import lru_cache

from app.core.config import DATA_DIR

ENGINE_VERSION = "rules-v1"


@lru_cache
def cfg() -> dict:
    return json.loads((DATA_DIR / "engine_config.json").read_text(encoding="utf-8"))


@lru_cache
def crops() -> dict[str, dict]:
    data = json.loads((DATA_DIR / "crops.json").read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["crops"]}


def crop_list() -> list[dict]:
    return list(crops().values())


def annual_crops() -> list[dict]:
    return [c for c in crop_list() if not c["perennial"]]


def status_of(score: float) -> str:
    s = cfg()["STATUS"]
    if score >= s["highly_suitable"]:
        return "highly_suitable"
    if score >= s["suitable"]:
        return "suitable"
    if score >= s["marginal"]:
        return "marginal"
    return "unsuitable"


def trapezoid(x: float, a: float, b: float, c: float, d: float) -> float:
    """Trapezoidal membership: 0 outside [a, d], 100 inside [b, c], linear in between."""
    if x is None or x != x or x in (float("inf"), float("-inf")):
        return 0.0
    if x <= a or x >= d:
        return 0.0
    if b <= x <= c:
        return 100.0
    return (x - a) / (b - a) * 100 if x < b else (d - x) / (d - c) * 100


def trapezoid_array(x, a: float, b: float, c: float, d: float):
    """Vectorised trapezoid for numpy arrays of finite values."""
    import numpy as np

    out = np.zeros_like(x, dtype=float)
    inside = (x >= b) & (x <= c)
    rising = (x > a) & (x < b)
    falling = (x > c) & (x < d)
    out[inside] = 100.0
    if b > a:
        out[rising] = (x[rising] - a) / (b - a) * 100
    if d > c:
        out[falling] = (d - x[falling]) / (d - c) * 100
    return out
