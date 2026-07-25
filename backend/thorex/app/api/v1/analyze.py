from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.core.config import get_settings
from app.pipeline import preprocess
from app.pipeline.orchestrator import run
from app.providers.mock_provider import MockProvider

router = APIRouter()
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
    try:
        result = run(data, file.filename or "upload", entitlement, _provider_factory())
    except preprocess.UnsupportedFormat:
        raise HTTPException(415, detail={"error": "unsupported_format"})
    except RuntimeError:
        raise HTTPException(503, detail={"error": "inference_unavailable"})
    return result.model_dump()
