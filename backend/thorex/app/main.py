from fastapi import FastAPI
from app.core.logging import configure_logging
from app.api.v1.router import api_router

configure_logging()
app = FastAPI(title="ThoreX AI Inference Service", version="0.1.0")
app.include_router(api_router, prefix="/v1")
