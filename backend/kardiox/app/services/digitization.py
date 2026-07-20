"""Stage 3 — Digitization (Phase 5B). Library: OpenCV + NumPy.

Converts the preprocessed (clean, de-gridded) ECG image into per-lead pixel traces + calibration.

REAL classical baseline (`ClassicalDigitization`): standard 3x4 (+ rhythm strip) layout detection
(`detect_lead_regions`) → per-column ink centre-line extraction per cell → grid/geometry-based px/mm
calibration. Deterministic; no learning.

Honest boundary: a single column-scan struggles with overlapping/low-contrast traces, and because 5A
removes the (colored) grid, px/mm is estimated from a **grid-FFT when a grid is still present, else from
the standard cell geometry** (2.5 s cell / 10 s rhythm strip at 25 mm/s) — an approximation. Production
accuracy needs a **learned digitizer** (train via PhysioNet `ecg-image-kit`); the `DigitizationProvider`
seam lets one drop in with no pipeline/route/iOS change. See docs/RESEARCH.md §5B.

Expected input:  processed PNG bytes (from stage 2).
Expected output: {"leads": {"II":[y_px,...], ...}, "calibration": {"mmPerS":25,"mmPerMv":10,"pxPerMm":N},
                  "layout": "twelveLead3x4", "method": "classical"}
Failure modes:   fewer than 3 leads carry ink -> LayoutUndetected (422).
"""
from __future__ import annotations

from app.core.errors import LayoutUndetected
from app.services.base import DigitizationProvider
from app.services.preprocessing import detect_lead_regions

_MM_PER_S = 25.0
_MM_PER_MV = 10.0
_CELL_SECONDS = 2.5          # a 3x4 cell shows 2.5 s
_STRIP_SECONDS = 10.0        # the rhythm strip shows 10 s
_MIN_INK_FRAC = 0.004        # a cell below this is treated as blank
_MIN_LEADS = 3               # fewer usable leads than this -> not a readable panel


def _lazy():
    try:
        import cv2
        import numpy as np
        return cv2, np
    except ImportError as e:  # pragma: no cover
        from app.core.errors import UpstreamUnavailable
        raise UpstreamUnavailable("opencv-python-headless / numpy not installed", stage="digitization") from e


def _extract_trace(ink_cell, np):
    """Per-column ink centre-line (row centroid). NaN columns are linearly interpolated. None if blank."""
    h, w = ink_cell.shape[:2]
    ys = np.full(w, np.nan, dtype="float64")
    for j in range(w):
        rows = np.where(ink_cell[:, j])[0]
        if rows.size:
            ys[j] = float(rows.mean())
    valid = ~np.isnan(ys)
    if valid.sum() < max(2, w // 10):
        return None
    idx = np.arange(w)
    ys[~valid] = np.interp(idx[~valid], idx[valid], ys[valid])
    return ys


def estimate_px_per_mm(gray, np) -> float | None:
    """Grid period via autocorrelation of the column projection. Returns px/mm if a periodic grid
    survives, else None (caller falls back to geometry). Works only when a grid is still present."""
    try:
        proj = gray.mean(axis=0).astype("float64")
        proj -= proj.mean()
        ac = np.correlate(proj, proj, mode="full")[proj.size - 1:]
        if ac[0] <= 0:
            return None
        ac = ac / ac[0]
        # smallest lag with a strong peak in the plausible 1mm range (3..40 px)
        for lag in range(3, min(40, ac.size)):
            if ac[lag] > 0.5 and ac[lag] >= ac[lag - 1] and ac[lag] >= ac[min(lag + 1, ac.size - 1)]:
                return float(lag)
        return None
    except Exception:
        return None


def digitize_bytes(image: bytes, layout_hint: str | None = None) -> dict:
    cv2, np = _lazy()
    buf = np.frombuffer(image, dtype=np.uint8)
    gray = cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)
    if gray is None or gray.size == 0:
        raise LayoutUndetected("Could not decode image for digitization", stage="digitization")
    H, W = gray.shape[:2]
    ink = gray < 128

    regions = detect_lead_regions(image)
    leads: dict = {}
    strip_w = None
    for reg in regions:
        if reg["inkFrac"] < _MIN_INK_FRAC:
            continue
        y, x, h, w = reg["y"], reg["x"], reg["h"], reg["w"]
        trace = _extract_trace(ink[y:y + h, x:x + w], np)
        if trace is None:
            continue
        leads[reg["lead"]] = [round(float(v), 2) for v in trace]
        if reg["lead"] == "II-rhythm":
            strip_w = w

    if len(leads) < _MIN_LEADS:
        raise LayoutUndetected(f"Only {len(leads)} readable leads; panel not detected", stage="digitization")

    # calibration: prefer grid-FFT (if a grid survived), else standard geometry.
    px_per_mm = estimate_px_per_mm(gray, np)
    calib_method = "grid"
    if not px_per_mm:
        if strip_w:
            px_per_mm = strip_w / (_STRIP_SECONDS * _MM_PER_S)      # 10 s strip
        else:
            cell_w = max((len(v) for v in leads.values()), default=W // 4)
            px_per_mm = cell_w / (_CELL_SECONDS * _MM_PER_S)        # 2.5 s cell
        calib_method = "geometry"

    return {
        "leads": leads,
        "calibration": {"mmPerS": _MM_PER_S, "mmPerMv": _MM_PER_MV,
                        "pxPerMm": round(float(px_per_mm), 3), "method": calib_method},
        "layout": "twelveLead3x4",
        "method": "classical",
    }


class NoneDigitization(DigitizationProvider):
    name = "none"

    async def digitize(self, image: bytes) -> dict:
        self._ni()


class ClassicalDigitization(DigitizationProvider):
    """REAL classical column-scan digitizer (Phase 5B). Activate via KARDIOX_PROVIDER_DIGITIZATION=classical."""

    name = "classical"
    version = "1.0.0"
    requires = ("cv2", "numpy")
    implemented = False   # real baseline; accuracy gated on validation + the learned upgrade

    async def digitize(self, image: bytes) -> dict:
        return digitize_bytes(image)


# Back-compat alias: the registry / config referred to "opencv"; keep it pointing at the real baseline.
class OpenCVDigitization(ClassicalDigitization):
    name = "opencv"


class ExternalDigitization(DigitizationProvider):
    """Plug in a learned digitizer (e.g. the PhysioNet-2024-winning ECG-Digitiser, BSD-2) WITHOUT changing
    the backend: set KARDIOX_DIGITIZER_ENTRYPOINT="module:function" to a callable(image_bytes)->traces
    dict ({"leads":{lead:[px...]}, "calibration":{...}}). Ships nothing itself; raises UpstreamUnavailable
    until an entrypoint is configured (never fabricates traces)."""

    name = "external"
    version = "0.1.0"

    def validate_config(self) -> list[str]:
        from app.core.config import get_settings
        return [] if get_settings().digitizer_entrypoint else ["KARDIOX_DIGITIZER_ENTRYPOINT not set"]

    async def digitize(self, image: bytes) -> dict:
        import asyncio

        from app.core.config import get_settings
        from app.core.errors import UpstreamUnavailable
        from app.services.models import resolve_entrypoint
        ep = get_settings().digitizer_entrypoint
        if not ep:
            raise UpstreamUnavailable(
                "No external digitizer configured (KARDIOX_DIGITIZER_ENTRYPOINT=module:function, e.g. an "
                "ECG-Digitiser wrapper). KardioX ships no learned digitizer weights.", stage="digitization")
        fn = resolve_entrypoint(ep)
        result = await asyncio.to_thread(fn, image)
        if not isinstance(result, dict) or "leads" not in result:
            raise UpstreamUnavailable("external digitizer returned an unexpected shape", stage="digitization")
        return result
