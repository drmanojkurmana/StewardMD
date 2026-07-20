"""POST /v1/ecg/analyze (the contract the iOS RemoteAnalyzer calls) + an SSE progress stream.

The edge Worker has already stored the image in R2 under sessionId; we receive the AnalyzeRequest JSON.
mock mode → return the canonical AF sample (so the app works end-to-end). live mode → run the pipeline
(501 not_implemented naming the failing stage until models are wired).
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse

from app.api.deps import get_providers, get_r2
from app.core.config import Settings, get_settings
from app.core.errors import KardioXError, PipelineTimeout, UpstreamUnavailable
from app.core.logging import bind_request, get_logger
from app.core.metrics import METRICS, latency
from app.core.security import require_pipeline_auth
from app.core.versioning import MEDIA_TYPE
from app.models.ecg import AnalyzeRequest, ECGAnalysis
from app.models.progress import StageProgress
from app.mock.sample import af_sample
from app.pipeline.orchestrator import run_pipeline
from app.pipeline.stages import ANALYSIS_STAGES
from app.services.registry import Providers
from app.storage.r2 import R2Client

router = APIRouter(prefix="/ecg", tags=["analyze"])
log = get_logger("analyze")


def _json(analysis: ECGAnalysis) -> JSONResponse:
    return JSONResponse(content=analysis.model_dump(exclude_none=True), media_type=MEDIA_TYPE)


@router.post("/analyze", summary="Analyze an ECG image (by sessionId)", dependencies=[Depends(require_pipeline_auth)])
async def analyze(req: AnalyzeRequest, settings: Settings = Depends(get_settings),
                  providers: Providers = Depends(get_providers), r2: R2Client = Depends(get_r2)):
    bind_request(session_id=req.sessionId, mode=settings.mode)
    log.info("analyze.start")
    METRICS.inc("kardiox_analyze_total", {"mode": settings.mode})
    METRICS.add_gauge("kardiox_analyze_inflight", 1)
    try:
        with latency("kardiox_analyze_duration_seconds", {"mode": settings.mode}):
            if settings.mode == "mock":
                return _json(af_sample(req.sessionId))
            analysis = await asyncio.wait_for(run_pipeline(req, providers, r2), timeout=settings.request_timeout_s)
        log.info("analyze.done")
        return _json(analysis)
    except KardioXError as e:
        METRICS.inc("kardiox_analyze_errors_total", {"code": e.code})
        raise
    except TimeoutError as e:
        METRICS.inc("kardiox_analyze_errors_total", {"code": "timeout"})
        raise PipelineTimeout("Analysis exceeded the time budget") from e
    finally:
        METRICS.add_gauge("kardiox_analyze_inflight", -1)


@router.get("/analyze/stream", summary="Analyze with Server-Sent Events stage progress",
            dependencies=[Depends(require_pipeline_auth)])
async def analyze_stream(sessionId: str, settings: Settings = Depends(get_settings),
                         providers: Providers = Depends(get_providers), r2: R2Client = Depends(get_r2)):
    req = AnalyzeRequest(sessionId=sessionId)

    async def gen():
        def sse(event: str, data) -> str:
            return f"event: {event}\ndata: {json.dumps(data)}\n\n"

        if settings.mode == "mock":
            for i, st in enumerate(ANALYSIS_STAGES):
                pct = round((i + 1) / len(ANALYSIS_STAGES) * 100)
                yield sse("progress", StageProgress(stage=st, status="done", pct=pct).model_dump())
                await asyncio.sleep(0.02)
            yield sse("result", af_sample(sessionId).model_dump(exclude_none=True))
            return

        queue: asyncio.Queue = asyncio.Queue()

        async def on_progress(p: StageProgress):
            await queue.put(("progress", p.model_dump()))

        async def worker():
            try:
                a = await run_pipeline(req, providers, r2, on_progress)
                await queue.put(("result", a.model_dump(exclude_none=True)))
            except KardioXError as e:
                await queue.put(("error", {"code": e.code, "message": e.message, "stage": e.stage}))
            except Exception:
                await queue.put(("error", {"code": UpstreamUnavailable.code, "message": "pipeline error", "stage": "report"}))
            finally:
                await queue.put(("__done__", None))

        task = asyncio.create_task(worker())
        try:
            while True:
                event, data = await queue.get()
                if event == "__done__":
                    break
                yield sse(event, data)
        finally:
            task.cancel()

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
