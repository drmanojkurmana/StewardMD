"""Stage 5 — Quality gate provider. The real scoring lives in the Phase-7 `quality_engine.QualityEngine`
(blur/rotation/shadow/resolution/noise/contrast/glare/grid/gain-speed/cropping/missing-leads + an OOD
model hook that stays Not Ready). This module is the thin provider that wires the engine into the pipeline.

Expected input:  raw image bytes.
Expected output: assess() -> the QualityEngine report; raises BadImage(stage="quality") when the gate
                 rejects (undecodable, blurry, low-res, low-contrast, or glare).
Boundary:        thresholds are seed values pending calibration against a labelled good/bad set.
"""
from __future__ import annotations

from app.core.errors import BadImage
from app.services.base import QualityProvider


class NoneQuality(QualityProvider):
    name = "none"

    async def assess(self, image: bytes) -> dict:
        self._ni()   # no gate configured → the orchestrator skips quality gating


class OpenCVQuality(QualityProvider):
    """REAL classical quality gate. Delegates to QualityEngine. Activate via KARDIOX_PROVIDER_QUALITY=opencv.
    Returns the full report; raises BadImage when the gate rejects (a "warn" gate passes with reasons)."""

    name = "opencv"
    version = "2.0.0"
    requires = ("cv2", "numpy")
    implemented = False   # detectors real; thresholds gated on calibration vs a labelled good/bad set

    async def assess(self, image: bytes) -> dict:
        from app.services.quality_engine import QualityEngine
        report = QualityEngine().assess(image)
        if report.get("gate") == "reject":
            raise BadImage("Image quality too low: " + "; ".join(report.get("reasons", [])), stage="quality")
        return report
