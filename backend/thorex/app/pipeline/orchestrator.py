import uuid
from app.core.config import get_settings
from app.core.logging import get_logger
from app.pipeline import preprocess, quality, assemble, localize
from app.models.schemas import AnalysisResult

log = get_logger("orchestrator")

# Grad-CAM heatmaps are only produced for the local TorchXRayVision engine
# (Grad-CAM needs the real model + a documented target layer). The HF/free
# and X-Raydar engines get no heatmap in P1.
_HEATMAP_ENGINE = "torchxrayvision"
_HEATMAP_BANDS = ("High", "Medium")


def run(data: bytes, filename: str, entitlement: str, provider_factory) -> AnalysisResult:
    # app.pipeline.redact is built in Task 8b; guard so Task 6 stands alone and
    # self-heals once redact.py lands. preprocess.prepare's default redact_hook
    # is already identity, so falling back to it here is safe.
    try:
        from app.pipeline.redact import redact_burned_in_text as _redact
    except ImportError:
        _redact = None

    prepared = (
        preprocess.prepare(data, filename)
        if _redact is None
        else preprocess.prepare(data, filename, redact_hook=_redact)
    )  # raises UnsupportedFormat
    qrep = quality.assess(prepared.array)
    providers = provider_factory(entitlement)
    engines = []
    mode = get_settings().mode
    for p in providers:
        pairs = p.detect(prepared)  # (label, prob); may raise RuntimeError -> 503
        result = assemble.engine_result(p.name, p.educational, pairs)
        if mode != "mock" and p.name == _HEATMAP_ENGINE:
            _attach_heatmaps(prepared, result)
        engines.append(result)
    return assemble.build(str(uuid.uuid4()), qrep, engines)


def _attach_heatmaps(prepared, engine_result) -> None:
    """Compute and attach a Grad-CAM heatmap to each High/Medium finding of
    the local TorchXRayVision engine result. Only called when
    settings.mode != "mock", so mock-mode contract tests never touch this
    path (no model load, no torch/grad-cam work).
    """
    from app.providers.torchxrayvision_provider import _model

    model = _model()  # cached singleton; already loaded by this engine's detect()
    _attach_heatmaps_for_model(prepared, engine_result, model)


def _attach_heatmaps_for_model(prepared, engine_result, model) -> None:
    """Unit-testable core of heatmap attachment: given an already-resolved
    model, compute a Grad-CAM heatmap for each High/Medium finding.

    The heatmap is an adjunct — the findings are the clinical payload. Any
    failure computing a heatmap (model/target-layer shape mismatch, GradCAM
    error, encoding error, etc.) is caught, logged (no image bytes), and
    leaves that finding's heatmap_png_b64 as None rather than propagating —
    a Grad-CAM hiccup must never turn a valid analyze response into a 500.
    Errors from detection/inference itself (p.detect in run()) are NOT
    touched by this guard and still raise/503 as before.
    """
    try:
        target_layer = localize.default_target_layer(model)
        pathologies = list(model.pathologies)
    except Exception as e:
        log.warning("heatmap_setup_failed", error=str(e))
        return

    for finding in engine_result.findings:
        if finding.band not in _HEATMAP_BANDS:
            continue
        if finding.label not in pathologies:
            continue
        class_index = pathologies.index(finding.label)
        try:
            finding.heatmap_png_b64 = localize.heatmap_for(
                model, prepared.array, class_index, target_layer
            )
        except Exception as e:
            log.warning("heatmap_attach_failed", label=finding.label, error=str(e))
