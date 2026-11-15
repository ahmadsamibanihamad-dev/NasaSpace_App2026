"""Crop knowledge base loader (backend/app/data/crops.json)."""

from __future__ import annotations

import json
from functools import lru_cache

from app.core.config import DATA_DIR

CROP_IDS = frozenset(
    ["wheat", "barley", "lentil", "chickpea", "vetch", "tomato", "cucumber", "potato", "onion", "eggplant", "olive", "date_palm", "citrus"]
)


@lru_cache
def load_crops() -> dict[str, dict]:
    path = DATA_DIR / "crops.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    crops = {c["id"]: c for c in data["crops"]}
    missing = CROP_IDS - crops.keys()
    if missing:
        raise RuntimeError(f"crops.json is missing crops: {sorted(missing)}")
    return crops


def get_crop(crop_id: str) -> dict | None:
    return load_crops().get(crop_id)


def v(crop: dict, *path: str, default=None):
    """Read a sourced value: crop['temperature']['optimal_min']['value']."""
    cur = crop
    for p in path:
        if not isinstance(cur, dict) or p not in cur:
            return default
        cur = cur[p]
    if isinstance(cur, dict) and "value" in cur:
        return cur["value"]
    return cur
