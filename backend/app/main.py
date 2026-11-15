import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from app.api import analyses, auth, farms, forecasts, geo, public
from app.core.config import APP_NAME, get_settings
from app.core.db import get_engine, init_db
from app.core.errors import install_error_handlers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ardna")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with Session(get_engine()) as session:
        n = analyses.fail_interrupted(session)
        if n:
            log.info("Marked %s interrupted analyses as failed", n)
    from app.ml.service import get_prediction_service

    status = get_prediction_service().status()  # loads models once, at startup
    log.info("AI mode: %s (ready=%s)", status["ai_mode"], status["ready"])
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title=f"{APP_NAME['en']} API",
        version="1.0.0",
        description="Agricultural decision support for farms in Jordan. Guests get crop recommendations for a location; signed-in users keep farms, parcels and history.",
        lifespan=lifespan,
        openapi_url="/api/v1/openapi.json",
        docs_url="/api/v1/docs",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in s.cors_origins.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    for r in (auth.router, geo.router, farms.router, analyses.router, forecasts.router, public.router):
        app.include_router(r, prefix="/api/v1")
    return app


app = create_app()
