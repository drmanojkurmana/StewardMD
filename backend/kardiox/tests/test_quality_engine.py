"""Phase 6 — Quality Engine. REAL classical image-quality gate. Runs in CI 'test-ml' (needs cv2/numpy).

Every test importorskips cv2/numpy so the suite is a no-op where the ML deps are absent (the module
itself imports without them). Images are built synthetically — no fixtures, no fabricated results.
"""
from __future__ import annotations

import pytest

from app.core.errors import BadImage

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

from app.services import quality_engine as QE  # noqa: E402

_CHECK_NAMES = {"blur", "rotation", "shadow", "resolution", "noise", "contrast",
                "glare", "grid", "speedGain", "cropping", "missingLeads", "ood"}


def _png(gray) -> bytes:
    ok, enc = cv2.imencode(".png", gray)
    assert ok
    return enc.tobytes()


def _sharp_gray(h: int = 480, w: int = 640):
    """High-focus, high-contrast random-noise field (seeded, deterministic)."""
    rng = np.random.default_rng(0)
    return rng.integers(0, 256, (h, w), dtype=np.uint8)


def test_sharp_noise_image_passes():
    r = QE.QualityEngine().assess(_png(_sharp_gray()))
    assert r["pass"] is True and r["gate"] != "reject"
    assert 0.0 <= r["overall"] <= 1.0
    assert r["checks"]["blur"]["pass"] is True
    assert r["checks"]["resolution"]["pass"] is True
    assert r["checks"]["contrast"]["pass"] is True


def test_heavily_blurred_rejects_with_blur_reason():
    blurred = cv2.GaussianBlur(_sharp_gray(), (21, 21), 0)
    r = QE.QualityEngine().assess(_png(blurred))
    assert r["pass"] is False and r["gate"] == "reject"
    assert r["checks"]["blur"]["pass"] is False
    assert any("blur" in reason for reason in r["reasons"])


def test_tiny_image_rejects_on_resolution():
    r = QE.QualityEngine().assess(_png(_sharp_gray(120, 120)))
    assert r["pass"] is False and r["gate"] == "reject"
    assert r["checks"]["resolution"]["pass"] is False
    assert any("resolution" in reason for reason in r["reasons"])


def test_all_white_rejects_on_glare_or_contrast():
    white = np.full((480, 640), 255, np.uint8)
    r = QE.QualityEngine().assess(_png(white))
    assert r["pass"] is False and r["gate"] == "reject"
    assert (r["checks"]["glare"]["pass"] is False) or (r["checks"]["contrast"]["pass"] is False)
    assert any(("glare" in x) or ("contrast" in x) for x in r["reasons"])


def test_ood_returns_none():
    assert QE.ood_score(_png(_sharp_gray())) is None
    assert QE.ood_score(b"") is None
    r = QE.QualityEngine().assess(_png(_sharp_gray()))
    assert r["checks"]["ood"]["score"] is None
    assert r["checks"]["ood"]["pass"] is True


def test_assess_shape_and_all_checks_present():
    r = QE.QualityEngine().assess(_png(_sharp_gray()))
    assert set(r.keys()) == {"overall", "pass", "gate", "checks", "reasons"}
    assert isinstance(r["overall"], float) and 0.0 <= r["overall"] <= 1.0
    assert isinstance(r["pass"], bool)
    assert r["gate"] in {"pass", "warn", "reject"}
    assert isinstance(r["reasons"], list) and all(isinstance(x, str) for x in r["reasons"])
    assert set(r["checks"].keys()) == _CHECK_NAMES
    for _name, c in r["checks"].items():
        assert set(c.keys()) == {"score", "pass", "detail"}
        assert c["score"] is None or isinstance(c["score"], float)
        assert isinstance(c["pass"], bool)
        assert isinstance(c["detail"], str)


def test_bad_bytes_raise_badimage():
    with pytest.raises(BadImage):
        QE.QualityEngine().assess(b"not-an-image")
    with pytest.raises(BadImage):
        QE.QualityEngine().assess(b"")
    with pytest.raises(BadImage):
        QE.missing_leads(b"nope")


def test_pure_detectors_on_arrays():
    sharp = _sharp_gray()
    blurred = cv2.GaussianBlur(sharp, (21, 21), 0)
    assert QE.blur_score(sharp) > QE.blur_score(blurred)
    assert QE.resolution_short_edge(sharp) == 480
    assert QE.glare_fraction(np.full((32, 32), 255, np.uint8)) == 1.0
    assert QE.contrast_std(np.full((32, 32), 128, np.uint8)) == 0.0
    assert QE.grid_present(np.full((64, 64), 200, np.uint8)) is False
    assert 0.0 <= QE.glare_fraction(sharp) <= 1.0


def test_missing_leads_flags_blank_panel():
    out = QE.missing_leads(_png(np.full((480, 640), 255, np.uint8)))
    assert out["ok"] is False and out["present"] == 0
    assert "II-rhythm" in out["missing"]
    assert out["expected"] == len(out["inkFrac"]) == 13


def test_estimate_speed_gain_safe_without_grid():
    out = QE.estimate_speed_gain(np.full((480, 640), 128, np.uint8))
    assert out["pxPerMm"] is None and out["ok"] is True
    assert {"pxPerMm", "impliedMmPerS", "impliedMmPerMv", "ok", "detail"} <= set(out.keys())
