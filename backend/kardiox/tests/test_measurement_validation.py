"""Phase 8 — measurement VALIDATION + benchmark (NeuroKit2 engine).

Validates the measurement engine against SYNTHETIC GROUND TRUTH (nk.ecg_simulate with a known heart
rate) — real validation, not fabricated. Clinical/PTB-XL validation (which also depends on upstream
digitization) remains a separate gate. Runs in CI 'test-ml' (needs neurokit2/numpy).
"""
from __future__ import annotations

import time

import pytest

np = pytest.importorskip("numpy")
nk = pytest.importorskip("neurokit2")

from app.services import measurement as M  # noqa: E402


def _sig(hr, fs=500, dur=10):
    ecg = nk.ecg_simulate(duration=dur, sampling_rate=fs, heart_rate=hr, method="ecgsyn")
    arr = np.asarray(ecg, dtype="float64")
    return {"leads": {"II": {"mv": arr.tolist(), "fs": fs},
                      "I": {"mv": arr.tolist(), "fs": fs},
                      "aVF": {"mv": arr.tolist(), "fs": fs}}, "duration_s": float(dur)}


@pytest.mark.parametrize("hr", [55, 75, 100])
def test_heart_rate_recovered_within_tolerance(hr):
    m = M.measure_signal(_sig(hr))
    assert m["heartRate"] is not None
    assert abs(m["heartRate"] - hr) <= 8, f"HR {m['heartRate']} not within 8 of ground truth {hr}"


def test_intervals_physiologic_when_present():
    m = M.measure_signal(_sig(72))
    assert m["delineationMethod"] == "dwt"
    if m["qrsMs"] is not None:
        assert 40 <= m["qrsMs"] <= 200
    if m["qtcMs"] is not None:
        assert 300 <= m["qtcMs"] <= 600
    assert isinstance(m["perLead"], dict) and "II" in m["perLead"]


def test_twave_polarity_reported():
    m = M.measure_signal(_sig(72))
    # a normal simulated ECG has an upright T wave in lead II; at minimum the field is well-formed
    assert m["tWave"] is not None
    assert m["tWave"]["polarity"] in ("positive", "negative", "flat")
    assert isinstance(m["tWave"]["amplitudeMv"], float)
    assert m["tWave"]["polarity"] != "negative"          # not inverted on a normal sim


def test_axis_computed_from_i_and_avf():
    m = M.measure_signal(_sig(72))
    assert m["axisDeg"] is not None


def test_graceful_on_unreadable():
    noise = {"leads": {"II": {"mv": list(np.zeros(200)), "fs": 500}}}
    m = M.measure_signal(noise)                          # flat line → no beats; must not crash
    assert m["heartRate"] is None
    assert M.measure_signal({"leads": {}})["quality"] == "no_signal"


def test_benchmark_completes_quickly():
    t0 = time.monotonic()
    M.measure_signal(_sig(75))
    elapsed = time.monotonic() - t0
    assert elapsed < 15.0, f"measurement took {elapsed:.1f}s (pathological)"   # catches hangs, not a SLA
