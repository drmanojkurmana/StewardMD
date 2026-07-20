"""Phase 7 — multi-digitizer ConsensusDigitization. Needs cv2/numpy → CI 'test-ml'."""
from __future__ import annotations

import asyncio

import pytest

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

from app.services import digitization as D  # noqa: E402
from app.services import preprocessing as P  # noqa: E402


def _panel(w=800, h=600) -> bytes:
    img = np.full((h, w, 3), 255, np.uint8)
    for x in range(0, w, 10):
        cv2.line(img, (x, 0), (x, h), (170, 170, 255), 1)
    xs = np.arange(w)
    ys = (h // 2 + 40 * np.sin(xs / 12.0)).astype(int)
    for x, y in zip(xs, ys):
        cv2.circle(img, (int(x), int(y)), 2, (0, 0, 0), -1)
    return cv2.imencode(".png", img)[1].tobytes()


def test_helpers_correlation_and_completeness():
    a = list(np.sin(np.arange(200) / 7.0))
    assert D._trace_corr(a, a, np) > 0.99                       # identical traces correlate ~1
    assert D._trace_corr(a, list(np.zeros(200)), np) is None    # degenerate (flat) → None
    tr = {"leads": {"I": [1], "II": [1], "V1": [1]}}
    assert 0.0 < D._completeness(tr) < 0.3                       # 3/12 std leads


def test_consensus_single_member_classical(monkeypatch):
    monkeypatch.setenv("KARDIOX_DIGITIZER_CONSENSUS_MEMBERS", "classical")
    from app.core.config import get_settings
    get_settings.cache_clear()
    processed = P.preprocess_bytes(_panel())
    out = asyncio.run(D.ConsensusDigitization().digitize(processed))
    c = out["consensus"]
    assert c["chosen"] == "classical"
    assert c["agreement"] is None and c["disagreement"] is False    # single member → no agreement
    assert 0.0 <= c["confidence"] <= 1.0
    assert [m for m in c["members"] if m["ok"]]                      # classical succeeded
    assert out["leads"]                                             # real traces present
    get_settings.cache_clear()


def test_consensus_skips_notready_external(monkeypatch):
    # external has no entrypoint → Not Ready → skipped; classical still yields a result (no raise).
    monkeypatch.setenv("KARDIOX_DIGITIZER_CONSENSUS_MEMBERS", "classical,external")
    monkeypatch.setenv("KARDIOX_DIGITIZER_ENTRYPOINT", "")
    from app.core.config import get_settings
    get_settings.cache_clear()
    out = asyncio.run(D.ConsensusDigitization().digitize(P.preprocess_bytes(_panel())))
    members = {m["name"]: m for m in out["consensus"]["members"]}
    assert members["classical"]["ok"] is True
    assert members["external"]["ok"] is False                       # isolated, not fatal
    get_settings.cache_clear()
