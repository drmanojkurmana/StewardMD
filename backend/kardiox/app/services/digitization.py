"""Stage 3 — Digitization (image → per-lead pixel traces). Library: OpenCV (+ classical CV / a lead-
detection model). README stage 3."""
from __future__ import annotations

from app.services.base import DigitizationProvider


class NoneDigitization(DigitizationProvider):
    name = "none"

    async def digitize(self, image: bytes) -> dict:
        self._ni()


class OpenCVDigitization(DigitizationProvider):
    """Detect the 12-lead panel layout, segment each lead cell, extract the ink centre-line as a pixel
    curve, and read the calibration pulse (25 mm/s, 10 mm/mV)."""

    name = "opencv"
    implemented = False

    async def digitize(self, image: bytes) -> dict:
        # TODO(models): detect the 3x4 (+ rhythm strip) grid; per cell, column-wise extract the darkest
        # ink y per x → a pixel trace; detect the calibration pulse to set px→mm. Return:
        #   {"leads": {"I": [...px...], ...}, "calibration": {"mmPerS": 25, "mmPerMv": 10, "pxPerMm": ...},
        #    "layout": "twelveLead3x4"}. Raise LayoutUndetected when the panel can't be found.
        self._ni()
