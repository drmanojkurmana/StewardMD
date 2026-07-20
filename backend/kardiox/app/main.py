"""FastAPI app factory — mounts the versioned router, OpenAPI docs, CORS, structured logging and the
contract exception handlers. Run: `uvicorn app.main:app`.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as v1_router
from app.core.config import get_settings
from app.core.errors import install_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.versioning import API_VERSION, V1_PREFIX


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    log = get_logger("startup")

    app = FastAPI(
        title=settings.app_name,
        version=API_VERSION,
        description="KardioX AI ECG interpretation pipeline. Decision support + education, NOT a diagnostic device.",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )
    install_exception_handlers(app)
    app.include_router(v1_router, prefix=V1_PREFIX)

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {"service": settings.app_name, "apiVersion": API_VERSION, "mode": settings.mode,
                "docs": "/docs", "health": f"{V1_PREFIX}/health"}

    log.info("startup", mode=settings.mode, api_version=API_VERSION)
    return app


app = create_app()
