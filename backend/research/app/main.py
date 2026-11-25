"""StewardMD Research Service entry point (legacy path, kept for CI).

Deterministic analysis is canonical in research-engine.js (the phone runs it
for previews; the Pages Function imports it for saved runs). The Python
meta-analysis service was retired in Phase 0 because research-engine.js is
canonical and the Python copy had the CI-level bug.

Phase 3 merged the service into the worker package: the FastAPI app now lives
in research_worker.app (GET /health plus the token-protected POST /drain).
This module re-exports it so `uvicorn app.main:app` and the existing tests
keep working. The container runs `uvicorn research_worker.app:app` with
PYTHONPATH pointing at worker/.
"""
from research_worker.app import app

__all__ = ["app"]