"""v1 router aggregation. New v2 would mount under its own prefix without touching v1."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import analyze, health, jobs, tools

router = APIRouter()
router.include_router(health.router)
router.include_router(analyze.router)
router.include_router(jobs.router)
router.include_router(tools.router)
