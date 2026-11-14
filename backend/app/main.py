import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, farms, geo
from app.core.config import APP_NAME, get_settings
from app.core.db import init_db
from app.core.errors import install_error_handlers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _optional_routers():
    """Routers added in later phases; imported lazily so earlier phases still run."""
    routers = []
    for mod in ("crops", "environment", "analyses"):
        try:
            m = __import__(f"app.api.{mod}", fromlist=["router"])
            routers.append(m.router)
        except ModuleNotFoundError as exc:
            if exc.name != f"app.api.{mod}":
                raise
    return routers


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    try:
        from app.engine.registry import init_engine

        init_engine()
    except ModuleNotFoundError:
        pass
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title=f"{APP_NAME['en']} API", version="1.0.0", lifespan=lifespan, openapi_url="/api/v1/openapi.json", docs_url="/api/v1/docs")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in s.cors_origins.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    for r in [auth.router, geo.router, farms.router, *_optional_routers()]:
        app.include_router(r, prefix="/api/v1")

    @app.get("/api/v1/health", tags=["meta"])
    def health():
        return {"ok": True, "app": APP_NAME, "engine": s.engine}

    return app


app = create_app()
