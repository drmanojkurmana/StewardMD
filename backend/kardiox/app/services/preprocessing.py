"""Stage 2 — Image enhancement. Library: OpenCV (opencv-python-headless)."""
from __future__ import annotations

from app.services.base import PreprocessingProvider


class NonePreprocessing(PreprocessingProvider):
    name = "none"

    async def enhance(self, image: bytes) -> bytes:
        self._ni()


class OpenCVPreprocessing(PreprocessingProvider):
    """Deskew & crop → CLAHE contrast → glare + gridline removal (README screen-04 steps)."""

    name = "opencv"
    implemented = False   # flip True once validated on real ECG photos

    async def enhance(self, image: bytes) -> bytes:
        # TODO(models): with OpenCV — decode; grayscale; deskew via Hough line / minAreaRect on the paper
        # border; CLAHE for local contrast; isolate trace ink with adaptive threshold; remove the mm grid
        # with morphological opening / FFT notch; re-encode to PNG. Return enhanced bytes.
        self._ni()
