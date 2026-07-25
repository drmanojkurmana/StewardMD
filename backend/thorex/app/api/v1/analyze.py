import time

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.core.config import get_settings
from app.core.logging import get_logger
from app.pipeline import preprocess
from app.pipeline.orchestrator import run
from app.providers.mock_provider import MockProvider
from app.services import storage

router = APIRouter()
log = get_logger("analyze")
MAX_BYTES = 25 * 1024 * 1024
ENTITLEMENTS = ("free", "v1", "v2beta")


def _provider_factory():
    mode = get_settings().mode

    def factory(ent: str):
        if mode == "mock":
            if ent == "free":
                return [MockProvider(name="hf_vit", educational=False)]
            base = [MockProvider(name="torchxrayvision", educational=False)]
            if ent == "v2beta":
                base.append(MockProvider(name="xraydar", educational=True))
            return base
        # real engines (Tasks 7, 8, 8b)
        if ent == "free":
            from app.providers.hf_provider import HFInferenceProvider
            return [HFInferenceProvider()]
        from app.providers.torchxrayvision_provider import TorchXRayVisionProvider
        providers = [TorchXRayVisionProvider()]
        if ent == "v2beta":
            from app.providers.xraydar_provider import XRaydarProvider
            providers.append(XRaydarProvider())
        return providers

    return factory


@router.post("/analyze")
async def analyze(file: UploadFile = File(...), entitlement: str = Form("v1")):
    if entitlement not in ENTITLEMENTS:
        raise HTTPException(400, detail={"error": "bad_entitlement"})
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, detail={"error": "file_too_large"})
    start = time.monotonic()
    try:
        with storage.temp_image(data):
            result = run(data, file.filename or "upload", entitlement, _provider_factory())
    except preprocess.UnsupportedFormat:
        raise HTTPException(415, detail={"error": "unsupported_format"})
    except RuntimeError:
        raise HTTPException(503, detail={"error": "inference_unavailable"})
    ms = int((time.monotonic() - start) * 1000)
    # Structured, PHI-safe log line: request_id/entitlement/phash/n_findings/ms
    # ONLY. Never log `data`, `file.filename`, pixel arrays, or any header.
    log.info(
        "analyzed",
        request_id=result.request_id,
        entitlement=entitlement,
        phash=preprocess.perceptual_hash(data),
        n_findings=sum(len(e.findings) for e in result.engines),
        ms=ms,
    )
    return result.model_dump()
