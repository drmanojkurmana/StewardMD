"""Dependency injection wiring for the API layer."""
from __future__ import annotations

from fastapi import Depends

from app.core.config import Settings, get_settings
from app.services.registry import Providers, build_providers
from app.storage.r2 import R2Client

_providers: Providers | None = None


def get_providers(settings: Settings = Depends(get_settings)) -> Providers:
    global _providers
    if _providers is None:
        _providers = build_providers(settings)
    return _providers


def get_r2(settings: Settings = Depends(get_settings)) -> R2Client:
    return R2Client(settings)
