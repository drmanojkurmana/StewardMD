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
    stages = providers.status()
    return {
        "status": "ok",
        "apiVersion": API_VERSION,
        "mode": settings.mode,
        "environment": settings.environment,
        "providers": stages,
        # In live mode, "ready" means every stage has a real implementation.
        "modelsReady": all(s["implemented"] for s in stages) if settings.mode == "live" else True,
    }
