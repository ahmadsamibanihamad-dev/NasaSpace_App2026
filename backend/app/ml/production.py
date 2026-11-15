"""Production prediction service: real model artifacts described by a model registry.

HOW TO PLUG THE TRAINED MODELS IN (nothing in the API or the frontend changes):

1. Put each model file under MODEL_DIR (default backend/app/ml/artifacts/).
2. Add one JSON manifest per model under MODEL_DIR/manifests/, for example:

       {
         "model_id": "t2m-rolling-7d",
         "model_version": "2026.11.1",
         "algorithm": "xgboost",                  # xgboost | lightgbm | sklearn
         "target": "T2M",                         # T2M | RH2M | SFMC | IMERG_PRECTOT
         "forecast_type": "rolling",              # rolling | calendar_season
         "horizon_days": 7,                       # 7 | 30 | 90 (rolling)
         "output": "daily",                       # daily | aggregate
         "feature_names": ["T2M_lag_0", "..."],   # exact names AND order used in training
         "preprocessing_artifact": null,          # optional scaler / pipeline file
         "training_range": ["2019-12-01", "2026-08-31"],
         "metrics": {"MAE": null, "RMSE": null},  # filled by the AI team; never invented here
         "supported_lead_times": [1, 2, 3, 4, 5, 6, 7],
         "artifact_path": "t2m_rolling_7d.json",
         "deployment_status": "deployed"          # deployed | staged | retired
       }

3. Implement `build_features` below with the SAME feature-engineering code used in training
   (lags, rolling windows, climatology, anomalies...). It needs the AI team's dataset schema and
   grid mapping, which have not been delivered yet.
4. Set AI_MODE=production.

If a model, its artifact or the feature pipeline is missing, the service answers with an explicit
"unavailable" error. It never falls back to mock data.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.errors import AppError
from app.ml.base import TARGETS, ForecastRequest, PredictionService

log = logging.getLogger("ardna.ml")


class ModelEntry(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_id: str
    model_version: str
    algorithm: str
    target: str
    forecast_type: str
    horizon_days: Optional[int] = None
    season: Optional[str] = None
    output: str = "daily"
    feature_names: list[str] = Field(default_factory=list)
    preprocessing_artifact: Optional[str] = None
    training_range: Optional[list[str]] = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    supported_lead_times: list[int] = Field(default_factory=list)
    artifact_path: str
    deployment_status: str = "staged"


def load_registry(model_dir: Path) -> tuple[list[ModelEntry], list[str]]:
    entries, problems = [], []
    for f in sorted((model_dir / "manifests").glob("*.json")):
        try:
            entries.append(ModelEntry(**json.loads(f.read_text(encoding="utf-8"))))
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{f.name}: {exc}")
            log.error("Invalid model manifest %s: %s", f.name, exc)
    return entries, problems


def load_artifact(entry: ModelEntry, model_dir: Path):
    """Load one model file. Only trusted local files: joblib/pickle can execute code on load."""
    path = model_dir / entry.artifact_path
    if not path.is_file():
        raise FileNotFoundError(path)
    if entry.algorithm == "xgboost":
        import xgboost as xgb  # optional dependency, installed with the models

        booster = xgb.Booster()
        booster.load_model(str(path))
        return booster
    if entry.algorithm == "lightgbm":
        import lightgbm as lgb

        return lgb.Booster(model_file=str(path))
    if entry.algorithm == "sklearn":
        import joblib

        return joblib.load(path)
    raise ValueError(f"Unsupported algorithm '{entry.algorithm}'")


def build_features(entry: ModelEntry, req: ForecastRequest, climate):
    """TODO(model delivery): generate the model's input row(s) with the training feature pipeline.

    Must return a 2-D array whose columns are exactly `entry.feature_names`, in that order, and must not
    use any observation dated after `req.forecast_origin`.
    """
    raise NotImplementedError("The shared feature-engineering pipeline has not been delivered yet")


class ProductionPredictionService(PredictionService):
    mode = "production"

    def __init__(self) -> None:
        self.model_dir = Path(get_settings().model_dir)
        self.entries, self.problems = load_registry(self.model_dir)
        self.models: dict[str, Any] = {}
        # load once at startup and reuse; a model that fails to load is reported, never replaced by mock data
        for e in self.entries:
            if e.deployment_status != "deployed":
                continue
            try:
                self.models[e.model_id] = load_artifact(e, self.model_dir)
            except Exception as exc:  # noqa: BLE001
                self.problems.append(f"{e.model_id}: {exc}")
                log.error("Could not load model %s: %s", e.model_id, exc)

    def _resolve(self, req: ForecastRequest, target: str) -> Optional[ModelEntry]:
        for e in self.entries:
            if e.model_id not in self.models or e.target != target or e.forecast_type != req.forecast_type:
                continue
            if req.forecast_type == "rolling" and e.horizon_days == req.horizon_days:
                return e
            if req.forecast_type == "calendar_season" and e.season in (None, req.season):
                return e
        return None

    def predict(self, req: ForecastRequest, climate) -> dict:
        req.period()  # validates the request
        resolved = {t: self._resolve(req, t) for t in TARGETS}
        missing = [t for t, e in resolved.items() if e is None]
        if missing:
            raise AppError(503, "MODEL_UNAVAILABLE", "No deployed model supports this forecast yet", {"missing_targets": missing})
        try:
            features = {t: build_features(e, req, climate) for t, e in resolved.items()}
        except NotImplementedError as exc:
            raise AppError(503, "FEATURE_PIPELINE_MISSING", str(exc)) from exc
        # TODO(model delivery): run inference per target, apply ensemble weights from the manifest if any,
        # then assemble the response with app.ml.base.build_response(data_mode="production", ...).
        raise AppError(503, "MODEL_UNAVAILABLE", "Inference is not wired yet", {"features_ready": sorted(features)})

    def status(self) -> dict:
        return {
            "ai_mode": "production",
            "ready": bool(self.models) and all(any(e.target == t and e.model_id in self.models for e in self.entries) for t in TARGETS),
            "models": [
                {
                    "model_id": e.model_id, "model_version": e.model_version, "algorithm": e.algorithm, "target": e.target,
                    "forecast_type": e.forecast_type, "horizon_days": e.horizon_days, "deployment_status": e.deployment_status,
                    "loaded": e.model_id in self.models, "metrics": e.metrics, "training_range": e.training_range,
                }
                for e in self.entries
            ],
            "problems": self.problems,
        }
