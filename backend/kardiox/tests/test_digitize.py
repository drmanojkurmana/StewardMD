"""Phase 5B — classical digitization, incl. an end-to-end preprocess -> digitize -> signal check.

Skips where cv2/numpy are absent; runs in the CI 'test-ml' job.
"""
from __future__ import annotations

import asyncio

import pytest

from app.core.errors import LayoutUndetected

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

from app.services import digitization as D  # noqa: E402
from app.services import preprocessing as P  # noqa: E402
from app.services import wfdb_io as W  # noqa: E402


def _panel_image(w=800, h=600) -> bytes:
    """White sheet with a red grid + a black sine trace spanning the panel (enough ink per cell)."""
    img = np.full((h, w, 3), 255, np.uint8)
    for x in range(0, w, 10):
        cv2.line(img, (x, 0), (x, h), (170, 170, 255), 1)
    for y in range(0, h, 10):
        cv2.line(img, (0, y), (w, y), (170, 170, 255), 1)
    xs = np.arange(w)
    ys = (h // 2 + 40 * np.sin(xs / 12.0)).astype(int)
    for x, y in zip(xs, ys):
        cv2.circle(img, (int(x), int(y)), 2, (0, 0, 0), -1)
    ok, enc = cv2.imencode(".png", img)
    return enc.tobytes()


def test_digitize_returns_traces_and_calibration():
    processed = P.preprocess_bytes(_panel_image())
    traces = D.digitize_bytes(processed)
    assert traces["layout"] == "twelveLead3x4" and traces["method"] == "classical"
    assert len(traces["leads"]) >= D._MIN_LEADS
    cal = traces["calibration"]
    assert cal["mmPerS"] == 25 and cal["mmPerMv"] == 10 and cal["pxPerMm"] > 0
    # every trace is a list of finite pixel rows
    for _lead, vals in traces["leads"].items():
        assert len(vals) > 10 and all(np.isfinite(v) for v in vals)


def test_blank_image_raises_layout_undetected():
    blank = cv2.imencode(".png", np.full((600, 800), 255, np.uint8))[1].tobytes()
    with pytest.raises(LayoutUndetected):
        D.digitize_bytes(blank)


def test_end_to_end_preprocess_digitize_to_signal():
    # 5A -> 5B -> 5C without NeuroKit: a calibrated signal with a real sampling rate falls out.
    processed = P.preprocess_bytes(_panel_image())
    traces = D.digitize_bytes(processed)
    signal = W.traces_to_signal(traces)
    assert signal["leads"], "expected at least one calibrated lead"
    any_lead = next(iter(signal["leads"].values()))
    assert any_lead["fs"] == 500 and len(any_lead["mv"]) > 0
    assert signal["duration_s"] > 0


def test_provider_and_alias():
    processed = P.preprocess_bytes(_panel_image())
    out = asyncio.run(D.ClassicalDigitization().digitize(processed))
    assert out["method"] == "classical"
    assert D.OpenCVDigitization().name == "opencv"      # back-compat alias still resolves


def test_none_digitization_raises():
    from app.core.errors import StageNotImplemented
    with pytest.raises(StageNotImplemented):
        asyncio.run(D.NoneDigitization().digitize(b"x"))
