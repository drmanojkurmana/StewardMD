"""Stage 5 — Quality gate (Phase 6). Library: OpenCV + NumPy. REAL classical image-quality scoring.

Rejects unusable ECG photos BEFORE the pipeline spends compute, routing them to `bad_image` (→ the
frontend's retake screen). Deterministic metrics — no learning:
  • resolution   — short edge >= threshold
  • focus        — variance of the Laplacian (low = blurry)
  • contrast     — grayscale std-dev
  • exposure     — mean brightness in range + glare fraction (near-white pixels) below a cap

Expected input:  raw image bytes.
Expected output: assess() -> {score, pass, metrics, reasons}; raises BadImage (with reasons) if unusable.
Failure modes:   undecodable bytes -> BadImage.

Boundary: metrics + thresholds are real + tunable; the thresholds themselves want calibration against a
labelled good/bad photo set before `implemented=True` for live gating.
"""
from __future__ import annotations

from app.core.config import get_settings
from app.core.errors import BadImage
from app.services.base import QualityProvider


def _lazy():
    try:
        import cv2
        import numpy as np
        return cv2, np
    except ImportError as e:  # pragma: no cover
        from app.core.errors import UpstreamUnavailable
        raise UpstreamUnavailable("opencv-python-headless / numpy not installed", stage="quality") from e


def score_image(image: bytes) -> dict:
    cv2, np = _lazy()
    if not image:
        raise BadImage("Empty image payload", stage="quality")
    gray = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if gray is None or gray.size == 0:
        raise BadImage("Could not decode image", stage="quality")
    s = get_settings()
    h, w = gray.shape[:2]
    short_edge = int(min(h, w))
    focus = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    contrast = float(gray.std())
    brightness = float(gray.mean())
    glare_frac = float((gray >= 250).mean())

    reasons = []
    if short_edge < s.quality_min_resolution:
        reasons.append(f"resolution too low ({short_edge}px < {s.quality_min_resolution}px)")
    if focus < s.quality_min_focus:
        reasons.append("image is blurry (out of focus)")
    if contrast < s.quality_min_contrast:
        reasons.append("insufficient contrast")
    if brightness < s.quality_min_brightness:
        reasons.append("image too dark")
    elif brightness > s.quality_max_brightness:
        reasons.append("image over-exposed")
    if glare_frac > s.quality_max_glare_frac:
        reasons.append("too much glare/reflection")

    def _n(v, lo, hi):
        return max(0.0, min(1.0, (v - lo) / (hi - lo))) if hi > lo else 0.0

    score = round((
        _n(short_edge, 0, s.quality_min_resolution * 2)
        + _n(focus, 0, s.quality_min_focus * 3)
        + _n(contrast, 0, s.quality_min_contrast * 3)
        + (1.0 - min(1.0, glare_frac / max(1e-6, s.quality_max_glare_frac)))
    ) / 4.0, 3)

    return {
        "score": score,
        "pass": len(reasons) == 0,
        "metrics": {"shortEdgePx": short_edge, "focusVar": round(focus, 1),
                    "contrastStd": round(contrast, 1), "brightness": round(brightness, 1),
                    "glareFrac": round(glare_frac, 4)},
        "reasons": reasons,
    }


class NoneQuality(QualityProvider):
    name = "none"

    async def assess(self, image: bytes) -> dict:
        self._ni()   # no gate configured → the orchestrator skips quality gating


class OpenCVQuality(QualityProvider):
    """REAL classical quality gate (Phase 6). Activate via KARDIOX_PROVIDER_QUALITY=opencv."""

    name = "opencv"
    version = "1.0.0"
    requires = ("cv2", "numpy")
    implemented = False   # metrics real; thresholds gated on calibration vs a labelled good/bad set

    async def assess(self, image: bytes) -> dict:
        result = score_image(image)
        if not result["pass"]:
            raise BadImage("Image quality too low: " + "; ".join(result["reasons"]), stage="quality")
        return result
