from pydantic import BaseModel

class QualityReport(BaseModel):
    view: str            # "PA" | "AP" | "portable" | "lateral" | "unknown"
    adequate: bool
    issues: list[str]    # e.g. ["under-exposed","rotated"]

class Finding(BaseModel):
    label: str
    band: str            # "High" | "Medium" | "Low"
    severity: str        # "mild" | "moderate" | "severe" | "n/a"
    relevance: str
    heatmap_png_b64: str | None = None

class EngineResult(BaseModel):
    engine: str          # "torchxrayvision" | "xraydar"
    educational: bool
    findings: list[Finding]
    disclaimer_key: str | None = None

class AnalysisResult(BaseModel):
    request_id: str
    quality: QualityReport | None
    engines: list[EngineResult]
    disclaimer_key: str = "clinical_assist_disclaimer"
