"""The 13 pipeline stages (README §AI Pipeline) — the SAME names the iOS AnalysisStage enum uses, so
streamed progress lines up with the frontend processing/analysis screens."""
from __future__ import annotations

ANALYSIS_STAGES = [
    "upload", "enhancement", "digitization", "signalExtraction", "quality",
    "rhythm", "beats", "measurement", "morphology", "st",
    "ruleValidation", "clinicalExplanation", "report",
]
