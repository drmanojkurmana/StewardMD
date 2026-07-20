"""Serial ECG comparison — deterministic clinical diff.

Pure Python: NO numpy/cv2/torch, so these run everywhere (no importorskip needed). They pin the
clinically meaningful behaviours: new AF flag, QTc-prolongation → worsened, resolved findings,
identical-inputs → stable, and the honest "missing measurement -> None delta + note" contract.
"""
from __future__ import annotations

import pytest

from app.core.errors import KardioXError, UpstreamUnavailable
from app.services import serial as S


def _meas(rate=None, qtc=None, axis=None):
    m = {}
    if rate is not None:
        m["ventRateBpm"] = rate
    if qtc is not None:
        m["qtcMs"] = qtc
    if axis is not None:
        m["axisDeg"] = axis
    return m


def test_new_af_flagged():
    current = {"findings": [{"label": "Atrial fibrillation", "severity": "urgent"}],
               "measurements": _meas(rate=118, qtc=410)}
    prior = {"findings": [{"label": "Sinus rhythm", "severity": "stable"}],
             "measurements": _meas(rate=76, qtc=408)}
    out = S.compare(current, prior)
    assert out["flags"]["newAF"] is True
    assert any("atrial fibrillation" in f.lower() for f in out["newFindings"])
    assert out["trend"] == "worsened"
    # rate jumped 42 bpm (> 20) -> a note is surfaced
    assert any("Ventricular rate changed" in n for n in out["notes"])


def test_qtc_400_to_460_flags_prolongation_and_worsened():
    current = {"measurements": _meas(qtc=460), "findings": []}
    prior = {"measurements": _meas(qtc=400), "findings": []}
    out = S.compare(current, prior)
    assert out["flags"]["qtProlongationChange"] is True
    assert out["deltas"]["qtcMs"] == 60.0
    assert out["trend"] == "worsened"


def test_qtc_shortening_is_improved_not_flagged_prolongation():
    current = {"measurements": _meas(qtc=405), "findings": []}
    prior = {"measurements": _meas(qtc=470), "findings": []}
    out = S.compare(current, prior)
    # a 65 ms SHORTENING is significant but is NOT prolongation → flag stays False, trend improves
    assert out["flags"]["qtProlongationChange"] is False
    assert out["deltas"]["qtcMs"] == -65.0
    assert out["trend"] == "improved"
    assert any("shorten" in n.lower() for n in out["notes"])


def test_resolved_finding_listed():
    prior = {"findings": [{"label": "Atrial fibrillation", "severity": "urgent"}],
             "measurements": _meas(rate=80, qtc=420, axis=30)}
    current = {"findings": [], "measurements": _meas(rate=78, qtc=418, axis=32)}
    out = S.compare(current, prior)
    assert "Atrial fibrillation" in out["resolvedFindings"]
    assert out["newFindings"] == []
    assert out["flags"]["newAF"] is False
    assert out["trend"] == "improved"   # an urgent finding resolved


def test_identical_inputs_stable_empty_new_resolved():
    ecg = {"findings": [{"label": "Left ventricular hypertrophy (voltage)", "severity": "warn"}],
           "measurements": _meas(rate=72, qtc=420, axis=15),
           "st": {"perLead": {"V2": 0.02, "V5": -0.01}, "territory": None}}
    out = S.compare(ecg, ecg)
    assert out["trend"] == "stable"
    assert out["newFindings"] == [] and out["resolvedFindings"] == []
    assert out["persistedFindings"] == ["Left ventricular hypertrophy (voltage)"]
    assert out["deltas"] == {"ventRateBpm": 0.0, "qtcMs": 0.0, "axisDeg": 0.0, "stMaxMv": 0.0}
    assert all(v is False for v in out["flags"].values())
    assert out["notes"] == []


def test_missing_measurements_none_deltas_and_note():
    out = S.compare({}, {})
    assert out["deltas"] == {"ventRateBpm": None, "qtcMs": None, "axisDeg": None, "stMaxMv": None}
    assert out["notes"], "missing data must produce explanatory notes"
    assert any("unavailable" in n for n in out["notes"])
    assert out["trend"] == "indeterminate"   # nothing comparable on either side


def test_partial_missing_measurement_notes_that_side():
    current = {"measurements": _meas(qtc=430)}          # no rate/axis
    prior = {"measurements": _meas(rate=70, qtc=425, axis=20)}
    out = S.compare(current, prior)
    assert out["deltas"]["qtcMs"] == 5.0
    assert out["deltas"]["ventRateBpm"] is None and out["deltas"]["axisDeg"] is None
    assert any("Ventricular rate unavailable in the current ECG" in n for n in out["notes"])
    assert any("QRS axis unavailable in the current ECG" in n for n in out["notes"])


def test_axis_shift_flag():
    current = {"measurements": _meas(axis=85, qtc=420)}
    prior = {"measurements": _meas(axis=10, qtc=420)}
    out = S.compare(current, prior)
    assert out["flags"]["axisShift"] is True
    assert out["deltas"]["axisDeg"] == 75.0


def test_dynamic_ischemia_from_st_worsening():
    current = {"st": {"perLead": {"V2": 0.25, "V3": 0.22}, "territory": "anterior"}}
    prior = {"st": {"perLead": {"V2": 0.05, "V3": 0.03}, "territory": None}}
    out = S.compare(current, prior)
    assert out["flags"]["stChange"] is True
    assert out["flags"]["dynamicIschemia"] is True
    assert out["deltas"]["stMaxMv"] == 0.2
    assert out["trend"] == "worsened"


def test_new_bbb_flag():
    current = {"findings": [{"label": "Bundle branch block / IVCD", "severity": "warn"}],
               "measurements": _meas(rate=75, qtc=420)}
    prior = {"findings": [{"label": "Sinus rhythm", "severity": "stable"}],
             "measurements": _meas(rate=74, qtc=418)}
    out = S.compare(current, prior)
    assert out["flags"]["newBBB"] is True


def test_case_insensitive_labels_persist_not_new():
    current = {"findings": ["atrial FIBRILLATION"]}
    prior = {"findings": ["Atrial Fibrillation"]}
    out = S.compare(current, prior)
    assert out["newFindings"] == [] and out["resolvedFindings"] == []
    assert len(out["persistedFindings"]) == 1
    assert out["flags"]["newAF"] is False


def test_bad_input_raises_typed_error():
    with pytest.raises(KardioXError):
        S.compare("not-an-analysis", {})
    with pytest.raises(KardioXError):
        S.compare({}, [1, 2, 3])


def test_ml_hook_never_fabricates():
    with pytest.raises(UpstreamUnavailable):
        S.predict_trend_model({"findings": []}, {"findings": []})
