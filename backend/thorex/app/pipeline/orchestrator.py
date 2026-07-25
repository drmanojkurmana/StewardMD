import uuid
from app.pipeline import preprocess, quality, assemble
from app.models.schemas import AnalysisResult


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
    for p in providers:
        pairs = p.detect(prepared)  # (label, prob); may raise RuntimeError -> 503
        engines.append(assemble.engine_result(p.name, p.educational, pairs))
    return assemble.build(str(uuid.uuid4()), qrep, engines)
