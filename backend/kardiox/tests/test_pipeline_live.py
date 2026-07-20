"""Phase 5F — end-to-end LIVE pipeline wiring with the real providers.

Runs the full orchestrator through opencv -> classical -> wfdb -> deterministic -> neurokit2 -> builtin
(gemini=none, which must be skipped non-blockingly). Proves the stages compose and produce a valid
ECGAnalysis contract on a synthetic image. Needs cv2 + neurokit2 -> runs in the CI 'test-ml' job.

This is an INTEGRATION test (wiring + contract), not a clinical-accuracy test — a synthetic sine is not a
real ECG. Accuracy validation requires labelled real data (see docs/RESEARCH.md).
"""
from __future__ import annotations

import asyncio

import pytest

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")
pytest.importorskip("neurokit2")


def _panel(w=800, h=600) -> bytes:
    img = np.full((h, w, 3), 255, np.uint8)
    for x in range(0, w, 10):
        cv2.line(img, (x, 0), (x, h), (170, 170, 255), 1)
    xs = np.arange(w)
    ys = (h // 2 + 40 * np.sin(xs / 12.0)).astype(int)
    for x, y in zip(xs, ys):
        cv2.circle(img, (int(x), int(y)), 2, (0, 0, 0), -1)
    return cv2.imencode(".png", img)[1].tobytes()


class _FakeR2:
    def __init__(self, img):
        self.img, self.deleted = img, False

    async def get_image(self, sid):
        return self.img

    async def delete_image(self, sid):
        self.deleted = True


def test_live_pipeline_end_to_end(monkeypatch):
    for k, v in {
        "KARDIOX_MODE": "live",
        "KARDIOX_PROVIDER_PREPROCESSING": "opencv",
        "KARDIOX_PROVIDER_DIGITIZATION": "classical",
        "KARDIOX_PROVIDER_WFDB": "wfdb",
        "KARDIOX_PROVIDER_RHYTHM": "deterministic",
        "KARDIOX_PROVIDER_MEASUREMENT": "neurokit2",
        "KARDIOX_PROVIDER_RULES": "builtin",
        "KARDIOX_PROVIDER_GEMINI": "none",
    }.items():
        monkeypatch.setenv(k, v)

    from app.core.config import get_settings
    get_settings.cache_clear()
    from app.models.ecg import AnalyzeRequest
    from app.pipeline.orchestrator import run_pipeline
    from app.services.registry import build_providers

    providers = build_providers(get_settings())
    r2 = _FakeR2(_panel())
    analysis = asyncio.run(run_pipeline(AnalyzeRequest(sessionId="live-1"), providers, r2))

    assert analysis.sessionId == "live-1" and analysis.schemaVersion
    assert isinstance(analysis.verdict, str)                 # descriptive rhythm or a diagnosis label
    assert analysis.clinicalInterpretation == ""             # gemini=none skipped, did NOT block
    assert analysis.confidenceBand in ("low", "medium", "high")
    assert r2.deleted is True                                # ephemeral upload erased
    # Phase 7 wiring flows through: consensus (fusion) attached; calibration ran (identity → False)
    assert isinstance(analysis.consensus, dict) and analysis.consensus.get("method") == "logodds-consensus"
    assert analysis.calibrated is False                      # temperature 1.0 = uncalibrated (honest)
    assert isinstance(analysis.explanations, list)
    get_settings.cache_clear()
