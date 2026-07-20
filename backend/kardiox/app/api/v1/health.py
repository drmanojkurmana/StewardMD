"""Health + readiness. Public (no auth) so the edge Worker and orchestrators can probe cheaply."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_providers
from app.core.config import Settings, get_settings
from app.core.versioning import API_VERSION
from app.services.registry import Providers

router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness + provider readiness")
async def health(settings: Settings = Depends(get_settings), providers: Providers = Depends(get_providers)) -> dict:
    reports = await providers.health_report()
    return {
        "status": "ok",
        "apiVersion": API_VERSION,
        "mode": settings.mode,
        "environment": settings.environment,
        "providers": reports,
        # Optional specialist model classifiers (MI/rare/conduction/morphology/beat) — Not Ready until
        # a validated checkpoint is configured; reported separately so the core stage list is stable.
        "specialists": await providers.specialist_health(),
        # In live mode, "modelsReady" means every core stage is implemented AND its deps/config are satisfied.
        "modelsReady": all(r["ready"] for r in reports) if settings.mode == "live" else True,
    }


@router.get("/ready", summary="Readiness probe (are the configured providers usable?)")
async def ready(settings: Settings = Depends(get_settings), providers: Providers = Depends(get_providers)):
    """Kubernetes-style readiness: 200 when the service can serve its CONFIGURED mode.

    mock mode is always ready. live mode is ready only when every provider reports ready — otherwise 503
    with the not-ready stages named (so an orchestrator doesn't route traffic to a half-wired pipeline).
    """
    from fastapi.responses import JSONResponse
    if settings.mode == "mock":
        return {"ready": True, "mode": "mock"}
    reports = await providers.health_report()
    not_ready = [{"stage": r["stage"], "name": r["name"], "configIssues": r["configIssues"]}
                 for r in reports if not r["ready"]]
    if not_ready:
        return JSONResponse(status_code=503, content={"ready": False, "mode": "live", "notReady": not_ready})
    return {"ready": True, "mode": "live"}
