"""Selects the prediction service from AI_MODE. Built once and reused (models load once)."""

from __future__ import annotations

from typing import Optional

from app.core.config import get_settings
from app.ml.base import DisabledPredictionService, PredictionService

_service: Optional[PredictionService] = None


def get_prediction_service() -> PredictionService:
    global _service
    if _service is None:
        mode = get_settings().ai_mode
        if mode == "mock":
            from app.ml.mock import MockPredictionService

            _service = MockPredictionService()
        elif mode == "production":
            from app.ml.production import ProductionPredictionService

            _service = ProductionPredictionService()
        else:
            _service = DisabledPredictionService()
    return _service


def set_prediction_service(service: Optional[PredictionService]) -> None:
    """Tests (and later the real models) can swap the implementation without touching the API."""
    global _service
    _service = service
