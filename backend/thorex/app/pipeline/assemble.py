from app.models.schemas import Finding, EngineResult, AnalysisResult, QualityReport
from app.pipeline.labels import relevance


def band(prob: float) -> str | None:
    if prob >= 0.60:
        return "High"
    if prob >= 0.30:
        return "Medium"
    if prob >= 0.10:
        return "Low"
    return None


def severity(prob: float) -> str:
    if prob >= 0.75:
        return "severe"
    if prob >= 0.45:
        return "moderate"
    if prob >= 0.10:
        return "mild"
    return "n/a"


def engine_result(
    engine: str, educational: bool, pairs: list[tuple[str, float]]
) -> EngineResult:
    findings: list[Finding] = []
    for label, prob in sorted(pairs, key=lambda x: x[1], reverse=True):
        b = band(prob)
        if b is None:
            continue
        findings.append(
            Finding(
                label=label,
                band=b,
                severity=severity(prob),
                relevance=relevance(label),
            )
        )
    return EngineResult(
        engine=engine,
        educational=educational,
        findings=findings,
        disclaimer_key="educational_not_clinical" if educational else None,
    )


def build(
    request_id: str,
    quality: QualityReport | None,
    engines: list[EngineResult],
) -> AnalysisResult:
    return AnalysisResult(request_id=request_id, quality=quality, engines=engines)
