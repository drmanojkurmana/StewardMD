"""Phase 5E/5F — deterministic morphology diagnoses + rule-engine integration.

Pure Python (no ML deps) — runs everywhere. Verifies the 5F contract: every diagnosis carries criteria,
confidence, differentials, and what-to-verify; and that the existing AF output is UNCHANGED.
"""
from __future__ import annotations

import asyncio

from app.services.rules import BuiltinRules, morphology_diagnoses

AF_FEAT = {"regularity": "irregular", "pWaves": "absent", "prMs": None, "fWaves": True,
           "rrSdSec": 0.31, "qtcMs": 468, "qrsMs": 92, "ventRateBpm": 128}


def _validate(feat):
    return asyncio.run(BuiltinRules().validate(feat))


def test_af_output_unchanged_and_in_diagnoses():
    out = _validate(AF_FEAT)
    af = [m for m in out["matched"] if m["cluster"] == "af"]
    assert len(af) == 3 and out["confidence"] == 0.82 and out["confidenceCapped"] is False
    ids = [d["id"] for d in out["diagnoses"]]
    assert "DX-AF" in ids
    dx_af = next(d for d in out["diagnoses"] if d["id"] == "DX-AF")
    assert dx_af["confidence"] == 0.82


def test_stemi_is_critical_with_full_evidence():
    feat = {"qrsMs": 92, "st": {"perLead": {"V2": 0.3, "V3": 0.25, "V4": 0.2}, "territory": "anterior"}}
    dxs = morphology_diagnoses(feat)
    stemi = next(d for d in dxs if d["id"] == "DX-STEMI")
    assert stemi["severity"] == "critical"
    assert stemi["criteria"] and stemi["differentials"] and stemi["whatToVerify"]
    assert any("STEMI" == d["label"] for d in stemi["differentials"])


def test_first_degree_av_block():
    dxs = morphology_diagnoses({"prMs": 240, "qrsMs": 90})
    assert any(d["id"] == "DX-AVB1" for d in dxs)


def test_bbb_and_wpw_and_qtc():
    assert any(d["id"] == "DX-BBB" for d in morphology_diagnoses({"qrsMs": 140, "perLead": {"V1": {"netMv": 0.5}}}))
    assert any(d["id"] == "DX-WPW" for d in morphology_diagnoses({"prMs": 100, "qrsMs": 120}))
    assert any(d["id"] == "DX-LQT" for d in morphology_diagnoses({"qtcMs": 500}))


def test_lvh_sokolow_lyon():
    feat = {"perLead": {"V1": {"sAmpMv": -2.0}, "V5": {"rAmpMv": 2.0}}}
    assert any(d["id"] == "DX-LVH" for d in morphology_diagnoses(feat))


def test_axis_deviation():
    assert any(d["label"] == "Left axis deviation" for d in morphology_diagnoses({"axisDeg": -45}))
    assert any(d["label"] == "Right axis deviation" for d in morphology_diagnoses({"axisDeg": 120}))


def test_normal_ecg_yields_no_diagnoses():
    feat = {"qrsMs": 90, "prMs": 160, "qtcMs": 400, "axisDeg": 40, "st": {"perLead": {}, "territory": None}}
    assert morphology_diagnoses(feat) == []


def test_every_diagnosis_has_5f_fields():
    # combine several abnormalities; check the contract holds for each produced diagnosis
    feat = {"prMs": 240, "qrsMs": 140, "qtcMs": 500, "axisDeg": -45,
            "perLead": {"V1": {"netMv": 0.5, "sAmpMv": -2.0}, "V5": {"rAmpMv": 2.0}},
            "st": {"perLead": {"V2": 0.3, "V3": 0.2}, "territory": "anterior"}}
    dxs = morphology_diagnoses(feat)
    assert len(dxs) >= 4
    for d in dxs:
        assert d["id"] and d["label"] and d["severity"]
        assert isinstance(d["confidence"], float) and 0.0 <= d["confidence"] <= 0.9
        assert d["criteria"] and d["differentials"] and d["whatToVerify"]
        assert d["evidence"]
    # sorted most-confident first
    assert all(dxs[i]["confidence"] >= dxs[i + 1]["confidence"] for i in range(len(dxs) - 1))
