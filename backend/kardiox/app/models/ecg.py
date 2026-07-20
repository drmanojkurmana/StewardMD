"""Wire models — 1:1 with the iOS ECGAnalysis contract (kardiox-models.js / README API Specification).

The JSON these produce is decoded by the frontend's `makeAnalysis()` (forward-compatible: unknown fields
ignored). Field names + units MUST match the frontend exactly.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["critical", "urgent", "warn", "stable", "info"]
ConfidenceBand = Literal["low", "medium", "high"]
LayoutHint = Literal["twelveLead3x4", "singleLead", "rhythmStrip"]


class AnalyzeRequest(BaseModel):
    """What the edge Worker POSTs (it already stored the image in R2 under sessionId)."""

    sessionId: str
    layoutHint: LayoutHint | None = None
    pages: int | None = None


class Evidence(BaseModel):
    lead: str = ""
    region: list[int] | None = None          # [startSample, endSample] for the highlight box
    ruleId: str = ""
    measuredValue: str = ""


class ECGFinding(BaseModel):
    id: str
    title: str
    detail: str = ""
    matched: bool = False
    weight: float | None = None
    severity: Severity = "info"
    evidence: list[Evidence] = Field(default_factory=list)


class MorphologyRow(BaseModel):
    label: str
    value: str


class Differential(BaseModel):
    label: str
    probability: float = 0.0


class ECGMeasurements(BaseModel):
    ventRateBpm: int | None = None
    rhythm: str = ""
    prMs: int | None = None
    qrsMs: int | None = None
    qtcMs: int | None = None
    axisDeg: int | None = None
    perLead: dict[str, dict[str, float]] | None = None


class RedFlag(BaseModel):
    title: str
    body: str


class ECGAnalysis(BaseModel):
    schemaVersion: str = "1.0"
    sessionId: str | None = None
    createdAt: str | None = None
    context: str | None = None
    verdict: str = ""
    verdictQualifier: str | None = None
    severity: Severity = "info"
    confidence: float = 0.0
    confidenceBand: ConfidenceBand = "low"
    leadStripLabel: str = ""
    measurements: ECGMeasurements = Field(default_factory=ECGMeasurements)
    morphology: list[MorphologyRow] = Field(default_factory=list)
    clinicalInterpretation: str = ""
    findings: list[ECGFinding] = Field(default_factory=list)
    differentials: list[Differential] = Field(default_factory=list)
    redFlag: RedFlag | None = None
    whatToVerify: str | None = None
    educationalRef: str | None = None
    # Phase 7 advanced-pipeline outputs (all additive + optional; the iOS decoder ignores unknown fields).
    qualityReport: dict | None = None       # QualityEngine.assess (image quality gate + per-check detail)
    signalQuality: float | None = None      # 0..1 signal-usability score
    consensus: dict | None = None           # evidence-fusion / consensus-engine result
    explanations: list[dict] = Field(default_factory=list)  # per-finding explainability
    calibrated: bool | None = None          # was the confidence calibrated (vs identity)
    # Provenance / audit (per README regulatory posture: model + content versions per analysis).
    modelVersions: dict[str, str] | None = None
