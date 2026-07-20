"""Phase 5B — layout + grid detection (app/services/layout.py).

Deterministic, no learning. Skips where cv2/numpy are absent; runs in the CI 'test-ml' job.
"""
from __future__ import annotations

import pytest

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

from app.core.errors import BadImage  # noqa: E402
from app.services import layout as L  # noqa: E402

_STANDARD_LEADS = {"I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"}


def _panel_3x4_rhythm(w: int = 640, h: int = 800) -> bytes:
    """A de-gridded 3x4 panel: 3 rows x 4 cells of thick trace segments + a full-width bottom rhythm strip.

    Thick horizontal strokes (not thin sines) keep the row/column density bands solid and unambiguous,
    which is exactly what a preprocessed, de-gridded panel looks like to the detector.
    """
    img = np.full((h, w), 255, np.uint8)
    grid_h = int(h * 0.75)          # top 75% holds the 3x4 grid
    rows, cols = 3, 4
    ch, cw = grid_h // rows, w // cols
    inset = 16                      # horizontal gap between adjacent cells so column bands separate
    for r in range(rows):
        cy = r * ch + ch // 2
        for c in range(cols):
            x0, x1 = c * cw + inset, (c + 1) * cw - inset
            cv2.line(img, (x0, cy), (x1, cy), 0, 8)
    strip_y = grid_h + (h - grid_h) // 2   # full-width rhythm strip in the bottom band
    cv2.line(img, (inset, strip_y), (w - inset, strip_y), 0, 8)
    return cv2.imencode(".png", img)[1].tobytes()


def _grid_image(period: int = 10, w: int = 200, h: int = 200) -> bytes:
    """White image with a regular dark mm-grid every `period` px in both axes."""
    img = np.full((h, w), 255, np.uint8)
    for x in range(0, w, period):
        cv2.line(img, (x, 0), (x, h), 40, 1)
    for y in range(0, h, period):
        cv2.line(img, (0, y), (w, y), 40, 1)
    return cv2.imencode(".png", img)[1].tobytes()


def _blank_image(w: int = 400, h: int = 400) -> bytes:
    return cv2.imencode(".png", np.full((h, w), 255, np.uint8))[1].tobytes()


def test_detect_layout_3x4_rhythm():
    out = L.detect_layout(_panel_3x4_rhythm())
    assert out["layout"] == "twelveLead3x4_rhythm"
    assert out["rows"] == 3 and out["cols"] == 4 and out["hasRhythmStrip"] is True
    assert 0.0 <= out["confidence"] <= 1.0 and out["confidence"] >= 0.5
    leads = {reg["lead"] for reg in out["regions"]}
    assert len(out["regions"]) >= 12
    assert _STANDARD_LEADS.issubset(leads)         # every standard 12-lead label is mapped
    assert "II-rhythm" in leads                    # ...plus the rhythm strip
    for reg in out["regions"]:                     # every region is a well-formed box with an ink fraction
        assert reg["w"] > 0 and reg["h"] > 0 and 0.0 <= reg["inkFrac"] <= 1.0


def test_detect_grid_10px_period():
    out = L.detect_grid(_grid_image(period=10))
    assert out["method"] == "autocorr"
    assert out["pxPerMm"] is not None and 8.0 <= out["pxPerMm"] <= 12.0
    assert out["confidence"] > 0.0
    assert out["mmPerS"] == 25.0 and out["mmPerMv"] == 10.0


def test_blank_image_is_low_confidence_and_graceful():
    grid = L.detect_grid(_blank_image())
    assert grid["method"] == "none" and grid["pxPerMm"] is None and grid["confidence"] == 0.0

    lay = L.detect_layout(_blank_image())
    assert lay["layout"] == "unknown" and lay["regions"] == [] and lay["confidence"] == 0.0


def test_undecodable_bytes_raise_bad_image():
    with pytest.raises(BadImage):
        L.detect_layout(b"not-an-image")
    with pytest.raises(BadImage):
        L.detect_grid(b"")
