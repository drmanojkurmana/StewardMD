"""Async job API (Phase 5 backend expansion) — ADDITIVE.

The synchronous POST /v1/ecg/analyze is unchanged (the iOS RemoteAnalyzer keeps using it). This adds an
optional fire-and-poll path for callers that prefer it:
  POST /v1/ecg/jobs        -> 202 {jobId, status:"queued"}   (runs the pipeline in the background)
  GET  /v1/ecg/jobs/{id}   -> {status, result|error, ...}

Store is in-memory + size-capped (last N). A distributed queue (Redis/RQ/Celery/Cloud Tasks) is the
scale path and drops in behind this same API — documented, not built, since it needs external infra.
"""
from __future__ import annotations

import asyncio
import uuid
from collections import OrderedDict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.api.deps import get_providers, get_r2
from app.core.config import Settings, get_settings
from app.core.errors import KardioXError
from app.core.logging import get_logger
from app.core.metrics import METRICS
from app.core.ratelimit import rate_limit
from app.core.security import require_pipeline_auth
from app.models.ecg import AnalyzeRequest
from app.mock.sample import af_sample
from app.pipeline.orchestrator import run_pipeline
from app.services.registry import Providers
from app.storage.r2 import R2Client

router = APIRouter(prefix="/ecg", tags=["jobs"])
log = get_logger("jobs")

_MAX_JOBS = 500
_JOBS: "OrderedDict[str, dict]" = OrderedDict()


def _put(job_id: str, data: dict) -> None:
    _JOBS[job_id] = data
    while len(_JOBS) > _MAX_JOBS:
        _JOBS.popitem(last=False)   # evict oldest


async def _run(job_id: str, req: AnalyzeRequest, settings: Settings, providers: Providers, r2: R2Client) -> None:
    _JOBS[job_id]["status"] = "running"
    METRICS.inc("kardiox_jobs_total", {"mode": settings.mode})
    try:
        if settings.mode == "mock":
            result = af_sample(req.sessionId).model_dump(exclude_none=True)
        else:
            analysis = await asyncio.wait_for(run_pipeline(req, providers, r2), timeout=settings.request_timeout_s)
            result = analysis.model_dump(exclude_none=True)
        _JOBS[job_id].update(status="done", result=result)
    except KardioXError as e:
        METRICS.inc("kardiox_jobs_errors_total", {"code": e.code})
        _JOBS[job_id].update(status="error", error={"code": e.code, "message": e.message, "stage": e.stage})
    except Exception:
        METRICS.inc("kardiox_jobs_errors_total", {"code": "pipeline_unavailable"})
        _JOBS[job_id].update(status="error", error={"code": "pipeline_unavailable", "message": "pipeline error", "stage": "report"})


@router.post("/jobs", summary="Submit an async analysis job", status_code=202,
             dependencies=[Depends(require_pipeline_auth), Depends(rate_limit)])
async def submit(req: AnalyzeRequest, settings: Settings = Depends(get_settings),
                 providers: Providers = Depends(get_providers), r2: R2Client = Depends(get_r2)):
    job_id = uuid.uuid4().hex
    _put(job_id, {"jobId": job_id, "status": "queued", "sessionId": req.sessionId})
    asyncio.create_task(_run(job_id, req, settings, providers, r2))
    log.info("job.submitted", job_id=job_id)
    return JSONResponse({"jobId": job_id, "status": "queued"}, status_code=202)


@router.get("/jobs/{job_id}", summary="Poll an async analysis job")
async def status(job_id: str) -> dict:
    job = _JOBS.get(job_id)
    if not job:
        raise KardioXError("Unknown job id", code="not_found", http=404, stage="report")
    return job
