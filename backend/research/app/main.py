"""StewardMD Research Service (health endpoint only).

Deterministic analysis is canonical in research-engine.js (the phone runs it
for previews; the Pages Function imports it for saved runs). The Python
meta-analysis service was retired in Phase 0 because research-engine.js is
canonical and the Python copy had the CI-level bug. This service keeps the
health endpoint for the Phase 3 external worker host.
"""
from __future__ import annotations

import os

from fastapi import FastAPI

app = FastAPI(
    title="StewardMD Research Service",
    version="0.1.0",
    description="Medical-first research orchestration and reproducible statistical analysis.",
    docs_url=None if os.getenv("RESEARCH_ENV") == "production" else "/docs",
    redoc_url=None if os.getenv("RESEARCH_ENV") == "production" else "/redoc",
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "stewardmd-research", "version": "0.1.0"}
