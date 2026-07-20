"""Phase 5C — signal extraction (WFDB) + measurement (NeuroKit2). Real behaviour on synthetic signals.

Skips where neurokit2/numpy are absent; runs in the CI 'test-ml' job (light ML deps, no torch).
"""
from __future__ import annotations

import asyncio

import pytest

from app.core.errors import LayoutUndetected

np = pytest.importorskip("numpy")
nk = pytest.importorskip("neurokit2")

from app.services import measurement as M  # noqa: E402
from app.services import wfdb_io as W  # noqa: E402


# ── WFDB / signal extraction ──────────────────────────────────────────────────────────────────────

def test_traces_to_signal_scales_and_times():
    # 800 columns, pxPerMm=8 -> 100 mm wide -> at 25 mm/s = 4.0 s. A sine of 40 px amplitude
    # -> 5 mm -> 0.5 mV at 10 mm/mV.
    cols = 800
    x = np.arange(cols)
    ypx = (240 - 40 * np.sin(x / 20.0)).tolist()  # y-down pixels around baseline 240
    sig = W.traces_to_signal({"leads": {"II": ypx}, "calibration": {"mmPerS": 25, "mmPerMv": 10, "pxPerMm": 8}})
    assert "II" in sig["leads"]
    lead = sig["leads"]["II"]
    assert lead["fs"] == 500
    assert abs(sig["duration_s"] - 4.0) < 0.05
    amp = max(abs(v) for v in lead["mv"])
    assert 0.35 < amp < 0.65, f"amplitude {amp} not ~0.5 mV"


def test_traces_missing_calibration_raises():
    with pytest.raises(LayoutUndetected):
        W.traces_to_signal({"leads": {"II": [1, 2, 3]}, "calibration": {"mmPerS": 25, "mmPerMv": 10}})


def test_wfdb_provider_async():
    ypx = (240 - 30 * np.sin(np.arange(500) / 15.0)).tolist()
    sig = asyncio.run(W.WfdbSignal().to_signal({"leads": {"II": ypx}, "calibration": {"pxPerMm": 8}}))
    assert sig["leads"]["II"]["fs"] == 500


# ── NeuroKit2 measurement ───────────────────────────────────────────────────────────────────────

def _sim_signal(hr=75, fs=500, dur=10):
    ecg = nk.ecg_simulate(duration=dur, sampling_rate=fs, heart_rate=hr, method="ecgsyn")
    return {"leads": {"II": {"mv": np.asarray(ecg, dtype="float64").tolist(), "fs": fs},
                      "I": {"mv": np.asarray(ecg, dtype="float64").tolist(), "fs": fs},
                      "aVF": {"mv": np.asarray(ecg, dtype="float64").tolist(), "fs": fs}},
            "duration_s": float(dur)}


def test_measure_heart_rate_recovered():
    m = M.measure_signal(_sim_signal(hr=75))
    assert m["sourceLead"] == "II"
    assert m["heartRate"] is not None and 65 <= m["heartRate"] <= 88, m["heartRate"]
    assert len(m["beats"]) >= 8


def test_measure_intervals_plausible_or_none():
    m = M.measure_signal(_sim_signal(hr=70))
    # delineation may not resolve every interval; when present they must be physiologic
    if m["qrsMs"] is not None:
        assert 40 <= m["qrsMs"] <= 200, m["qrsMs"]
    if m["qtcMs"] is not None:
        assert 250 <= m["qtcMs"] <= 600, m["qtcMs"]
    if m["prMs"] is not None:
        assert 80 <= m["prMs"] <= 320, m["prMs"]
    assert isinstance(m["perLead"], dict) and "II" in m["perLead"]
    assert m["axisDeg"] is not None  # I and aVF present


def test_st_near_zero_on_clean_signal():
    st = M.st_signal(_sim_signal(hr=75))
    assert st["territory"] is None
    for lead, val in st["perLead"].items():
        assert abs(val) < 0.15, f"{lead} ST {val} should be ~0 on a clean simulated ECG"


def test_measure_no_signal_graceful():
    m = M.measure_signal({"leads": {}, "duration_s": 0})
    assert m["heartRate"] is None and m["quality"] == "no_signal"


def test_none_measurement_raises():
    from app.core.errors import StageNotImplemented
    with pytest.raises(StageNotImplemented):
        asyncio.run(M.NoneMeasurement().measure({}))
