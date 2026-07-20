"""Phase 5D — rhythm/beats/morphology.

- Deterministic-provider tests need neurokit2 (per-test importorskip; run in CI 'test-ml').
- The TorchECG-boundary test needs NO ML deps and runs everywhere: with no checkpoint it MUST raise
  UpstreamUnavailable rather than fabricate a label. This is the honest-boundary guarantee.
"""
from __future__ import annotations

import asyncio

import pytest

from app.core.errors import UpstreamUnavailable


def _sim(hr=75, hr_std=1, fs=500, dur=10):
    import neurokit2 as nk
    import numpy as np
    ecg = nk.ecg_simulate(duration=dur, sampling_rate=fs, heart_rate=hr, heart_rate_std=hr_std, method="ecgsyn")
    return {"leads": {"II": {"mv": np.asarray(ecg, dtype="float64").tolist(), "fs": fs}}, "duration_s": float(dur)}


def test_deterministic_rhythm_regular_non_diagnostic():
    pytest.importorskip("neurokit2"); pytest.importorskip("numpy")
    from app.services import rhythm as R
    out = R.rhythm_from_signal(_sim(hr=75, hr_std=1))
    assert out["rateBpm"] is not None and 65 <= out["rateBpm"] <= 88
    assert out["regularity"] == "regular"
    # the label must be DESCRIPTIVE, never a diagnosis
    low = out["label"].lower()
    assert "regular" in low
    for diag in ("fibrillation", "flutter", "infarct", "block", "stemi"):
        assert diag not in low


def test_deterministic_rhythm_returns_valid_regularity_when_variable():
    pytest.importorskip("neurokit2"); pytest.importorskip("numpy")
    from app.services import rhythm as R
    out = R.rhythm_from_signal(_sim(hr=80, hr_std=25))
    assert out["regularity"] in ("regular", "irregular")
    assert "rrCov" in out


def test_beats_detected_but_not_classified():
    pytest.importorskip("neurokit2"); pytest.importorskip("numpy")
    from app.services import rhythm as R
    b = R.beats_from_signal(_sim(hr=75))
    assert len(b["beats"]) >= 8 and b["classified"] is False
    assert all(bt["label"] == "qrs" for bt in b["beats"])


def test_morphology_pwave_state():
    pytest.importorskip("neurokit2"); pytest.importorskip("numpy")
    from app.services import rhythm as R
    m = R.morphology_from_signal(_sim(hr=75))
    assert m["pWaves"] in ("present", "absent", "uncertain")
    assert m["bbb"] is None and m["hypertrophy"] is None  # diagnoses left to the Rule Engine


def test_no_signal_graceful():
    pytest.importorskip("neurokit2"); pytest.importorskip("numpy")
    from app.services import rhythm as R
    out = R.rhythm_from_signal({"leads": {}, "duration_s": 0})
    assert out["rateBpm"] is None and out["regularity"] is None


def test_torchecg_requires_checkpoint_never_fakes():
    # No ML deps needed: the empty-path guard fires before any torch import.
    from app.core.config import get_settings
    from app.services.rhythm import TorchECGRhythm
    get_settings.cache_clear()
    with pytest.raises(UpstreamUnavailable):
        asyncio.run(TorchECGRhythm().rhythm({"leads": {"II": {"mv": [0, 1, 0], "fs": 500}}}))
    get_settings.cache_clear()


def test_none_rhythm_raises():
    from app.core.errors import StageNotImplemented
    from app.services.rhythm import NoneRhythm
    with pytest.raises(StageNotImplemented):
        asyncio.run(NoneRhythm().rhythm({}))
