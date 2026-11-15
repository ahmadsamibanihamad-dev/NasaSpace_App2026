Extract into NASA_FINAL (merge AI folder, keep existing forecasting files).
From NASA_FINAL with the same Python environment used for training:
python -m pip install fastapi uvicorn
python -m uvicorn AI.recommendation_api:app --reload
Open http://127.0.0.1:8000/docs
POST /api/recommendations/demo uses existing historical demo and saved hybrid models; example {"latitude":32.55,"longitude":35.85,"irrigation_available":true}.
POST /api/recommendations/evaluate accepts actual aggregate forecasts from backend, one horizon at a time. See Swagger schema.
Existing FastAPI: from AI.recommendation_api import router; app.include_router(router)
No training. Demo origin historical; no GPS live feature builder. Optional soil_ph must be provided by backend from static soil data or omitted; never invented. Generic rule weights and moisture/humidity/rain proxies are unvalidated MVP design choices. Consult local agronomy before real planting; no irrigation prescription. Early leafy harvest may exceed 30 days. API does not provide authentication or public deployment security.
