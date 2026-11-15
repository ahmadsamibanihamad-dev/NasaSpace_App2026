"""The crops the site knows: the AI team's crop table (backend/nasa_final/AI/crop_requirements.json)."""

import json
from functools import lru_cache
from pathlib import Path

CATALOG = Path(__file__).resolve().parents[2] / "nasa_final" / "AI" / "crop_requirements.json"


@lru_cache
def load_crops() -> dict[str, dict]:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    return {c["id"]: c for c in data["crops"]}


CROP_IDS = frozenset(load_crops())
