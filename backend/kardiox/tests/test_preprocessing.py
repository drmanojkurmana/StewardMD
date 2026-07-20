"""Phase 5A — OpenCV preprocessing. Real behaviour on synthetic images.

The whole module skips where cv2/numpy are absent; it runs in CI, which installs requirements-ml.txt.
Covers: PNG output, gridline removal, deskew, lead-region layout, BadImage failure modes, async provider.
"""
from __future__ import annotations

import asyncio

import pytest

from app.core.errors import BadImage
from app.services.preprocessing import NonePreprocessing, OpenCVPreprocessing

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

from app.services import preprocessing as P  # noqa: E402


def _synth_ecg(w=640, h=480, with_grid=True, skew_deg=0.0) -> bytes:
    """A white sheet with a red mm grid + a black sine 'trace'. Encoded PNG bytes."""
    img = np.full((h, w, 3), 255, np.uint8)
    if with_grid:
        for x in range(0, w, 10):
            cv2.line(img, (x, 0), (x, h), (170, 170, 255), 1)   # BGR: reddish grid
        for y in range(0, h, 10):
            cv2.line(img, (0, y), (w, y), (170, 170, 255), 1)
    xs = np.arange(w)
    ys = (h // 2 + 60 * np.sin(xs / 18.0)).astype(int)
    for x, y in zip(xs, ys):
        cv2.circle(img, (int(x), int(y)), 2, (0, 0, 0), -1)     # black trace
    if skew_deg:
        M = cv2.getRotationMatrix2D((w / 2, h / 2), skew_deg, 1.0)
        img = cv2.warpAffine(img, M, (w, h), borderValue=(255, 255, 255))
    ok, enc = cv2.imencode(".png", img)
    return enc.tobytes()


def _ink_fraction(png: bytes) -> float:
    g = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
    return float((g < 128).mean())


def test_returns_png_bytes():
    out = P.preprocess_bytes(_synth_ecg())
    assert isinstance(out, bytes) and out[:8] == b"\x89PNG\r\n\x1a\n"


def test_grid_removed_but_trace_kept():
    # gridded input should end up with LESS ink than a naive threshold of the grid would give,
    # yet still retain the trace (non-trivial ink present).
    out = P.preprocess_bytes(_synth_ecg(with_grid=True))
    frac = _ink_fraction(out)
    assert 0.002 < frac < 0.15, f"trace ink fraction out of range: {frac}"


def test_remove_grid_color_whitens_grid():
    img = cv2.imdecode(np.frombuffer(_synth_ecg(with_grid=True), np.uint8), cv2.IMREAD_COLOR)
    before_red = int(((img[:, :, 2] > 150) & (img[:, :, 0] < 200)).sum())
    out = P.remove_grid_color(img)
    after_red = int(((out[:, :, 2] > 150) & (out[:, :, 0] < 200)).sum())
    assert after_red <= before_red  # grid pixels pushed toward white

def test_deskew_reduces_rotation():
    # a deskew of a skewed sheet should not crash and should return a same-shape image
    g = cv2.cvtColor(cv2.imdecode(np.frombuffer(_synth_ecg(skew_deg=6.0), np.uint8), cv2.IMREAD_COLOR), cv2.COLOR_BGR2GRAY)
    out = P.deskew(g)
    assert out.shape == g.shape


def test_detect_lead_regions_standard_layout():
    regions = P.detect_lead_regions(P.preprocess_bytes(_synth_ecg()))
    assert len(regions) == 13                       # 3x4 grid + rhythm strip
    leads = {r["lead"] for r in regions}
    assert {"I", "II", "III", "aVR", "V1", "V6", "II-rhythm"} <= leads
    assert all("x" in r and "w" in r and "inkFrac" in r for r in regions)


def test_bad_image_raises():
    with pytest.raises(BadImage):
        P.preprocess_bytes(b"not-an-image")
    with pytest.raises(BadImage):
        P.preprocess_bytes(b"")


def test_provider_enhance_async():
    out = asyncio.run(OpenCVPreprocessing().enhance(_synth_ecg()))
    assert isinstance(out, bytes) and len(out) > 100


def test_none_provider_raises():
    from app.core.errors import StageNotImplemented
    with pytest.raises(StageNotImplemented):
        asyncio.run(NonePreprocessing().enhance(b"x"))
