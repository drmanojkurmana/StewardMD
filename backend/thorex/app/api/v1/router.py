from fastapi import APIRouter
from app.api.v1 import health, analyze

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(analyze.router, tags=["analyze"])
