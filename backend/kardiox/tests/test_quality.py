"""Phase 6 — Quality gate. Real classical image-quality scoring. Runs in CI 'test-ml' (needs cv2)."""
from __future__ import annotations

import asyncio

import pytest

from app.core.errors import BadImage, StageNotImplemented

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

from app.services import quality as Q  # noqa: E402


def _png(gray) -> bytes:
    return cv2.imencode(".png", gray)[1].tobytes()


def _sharp(h=480, w=640) -> bytes:
    rng = np.random.default_rng(0)
    return _png(rng.integers(0, 256, (h, w), dtype=np.uint8))     # high focus + contrast


def test_sharp_image_passes():
    r = Q.score_image(_sharp())
    assert r["pass"] is True and r["score"] > 0
    assert r["metrics"]["shortEdgePx"] == 480 and r["metrics"]["focusVar"] > 60


def test_blurry_image_fails_and_assess_raises():
    blurred = cv2.GaussianBlur(cv2.imdecode(np.frombuffer(_sharp(), np.uint8), cv2.IMREAD_GRAYSCALE), (21, 21), 0)
    r = Q.score_image(_png(blurred))
    assert r["pass"] is False and any("blur" in x for x in r["reasons"])
    with pytest.raises(BadImage):
        asyncio.run(Q.OpenCVQuality().assess(_png(blurred)))


def test_low_resolution_fails():
    rng = np.random.default_rng(1)
    small = _png(rng.integers(0, 256, (120, 120), dtype=np.uint8))
    r = Q.score_image(small)
    assert r["pass"] is False and any("resolution" in x for x in r["reasons"])


def test_over_exposed_fails():
    white = _png(np.full((480, 640), 255, np.uint8))
    r = Q.score_image(white)
    assert r["pass"] is False  # glare + no contrast


def test_assess_good_returns_metrics():
    out = asyncio.run(Q.OpenCVQuality().assess(_sharp()))
    assert out["pass"] is True and "metrics" in out


def test_bad_bytes_raise():
    with pytest.raises(BadImage):
        Q.score_image(b"nope")


def test_none_quality_skips():
    with pytest.raises(StageNotImplemented):
        asyncio.run(Q.NoneQuality().assess(b"x"))
