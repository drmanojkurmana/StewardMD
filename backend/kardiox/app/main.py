"""FastAPI app factory — mounts the versioned router, OpenAPI docs, CORS, structured logging and the
contract exception handlers. Run: `uvicorn app.main:app`.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

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
    @app.middleware("http")
    async def request_context(request, call_next):
        # Request-ID + correlation-ID for every request → bound to structured logs + echoed on the
        # response. Honors inbound X-Request-ID / X-Correlation-ID (edge Worker can propagate them).
        import uuid

        from app.core.logging import bind_request, clear_request
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        cid = request.headers.get("x-correlation-id") or rid
        bind_request(request_id=rid, correlation_id=cid)
        try:
            response = await call_next(request)
        finally:
            clear_request()
        response.headers["X-Request-ID"] = rid
        response.headers["X-Correlation-ID"] = cid
        # API hardening headers (defense-in-depth; the edge/CF add TLS + HSTS).
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    install_exception_handlers(app)
    app.include_router(v1_router, prefix=V1_PREFIX)

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {"service": settings.app_name, "apiVersion": API_VERSION, "mode": settings.mode,
                "docs": "/docs", "health": f"{V1_PREFIX}/health"}

    @app.get("/metrics", include_in_schema=False)
    async def metrics() -> PlainTextResponse:
        # Prometheus text exposition. Restrict to the internal network in production.
        from app.core.metrics import METRICS
        return PlainTextResponse(METRICS.render(), media_type="text/plain; version=0.0.4")

    log.info("startup", mode=settings.mode, api_version=API_VERSION)
    return app


app = create_app()
