import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, crop_rotation, farms, geo, outlook, public
from app.core.config import APP_NAME, get_settings
from app.core.db import init_db
from app.core.errors import install_error_handlers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ardna")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title=f"{APP_NAME['en']} API",
        version="1.0.0",
        description="Agricultural decision support for farms in Jordan, built on the AI team's forecasts and recommendation rules. Guests get forecasts and plans for a location; signed-in users keep farms, parcels and saved plans.",
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
    for r in (auth.router, geo.router, farms.router, outlook.router, crop_rotation.router, public.router):
        app.include_router(r, prefix="/api/v1")
    return app


app = create_app()
