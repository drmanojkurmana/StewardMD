"""Explainability engine — pure python, no ML deps; runs in the base 'test' job.

Guarantees under test: the explanation is assembled STRICTLY from the finding + ctx (leads, rules, why,
measurements come from the finding; windows from delineation/beats; agree/disagree from ctx.fusion), it
invents nothing when the context is sparse (no delineation/beats -> no windows; no fusion -> no model
lists), the confidence echoes the finding, and a non-dict finding raises a typed error.
"""
from __future__ import annotations

import pytest

from app.core.errors import KardioXError
from app.services.explain import explain_finding

# A fabricated (hand-built, NOT model-produced) atrial-fibrillation finding in the rule-engine shape.
AF_FINDING = {
    "id": "DX-AF",
    "label": "Atrial fibrillation",
    "severity": "urgent",
    "confidence": 0.82,
    "criteria": [
        {"id": "RHY-AF-01", "description": "Irregularly irregular R-R", "measuredValue": "RR variance 0.31s",
         "weight": 0.34, "matched": True, "lead": "II"},
        {"id": "RHY-PWAVE-ABSENT", "description": "Absent P waves", "measuredValue": "No atrial activity",
         "weight": 0.29, "matched": True},
        {"id": "MOR-FWAVE-01", "description": "Fibrillatory baseline", "measuredValue": "f-waves in V1",
         "weight": 0.19, "matched": True, "lead": "V1"},
    ],
    "differentials": [{"label": "Atrial fibrillation", "probability": 0.82}],
    "whatToVerify": "Confirm no flutter waves; correlate with pulse.",
    "evidence": [
        {"lead": "II", "ruleId": "RHY-AF-01", "measuredValue": "RR variance 0.31s"},
        {"lead": "V1", "ruleId": "MOR-FWAVE-01", "measuredValue": "f-waves in V1"},
    ],
}


def _ctx(**over):
    base = {
        "measurements": {"heartRate": 128.0, "beats": [0.2, 0.9, 1.7, 2.5], "perLead": {"II": {"rAmpMv": 1.1}}},
        "st": {"perLead": {}, "territory": None},
        "rhythm": {"label": "irregular rhythm", "rateBpm": 128, "regularity": "irregular"},
        "validated": {"confidence": 0.82},
        "fusion": None,
        "delineation": None,
        "fs": 500,
    }
    base.update(over)
    return base


def test_leads_rules_why_and_confidence_from_finding():
    out = explain_finding(AF_FINDING, _ctx())
    # leads populated, STANDARD_12-ordered (II before V1)
    assert out["leads"] == ["II", "V1"]
    # rulesPassed = matched-criteria descriptions, non-empty
    assert out["rulesPassed"] and "Irregularly irregular R-R" in out["rulesPassed"]
    assert "Absent P waves" in out["rulesPassed"]
    # why mentions the criteria and the label, no new claims
    assert out["why"].startswith("Atrial fibrillation is supported by")
    assert "Irregularly irregular R-R" in out["why"]
    # confidence echoes the finding
    assert out["confidence"] == 0.82
    # measurements come from the criteria's measured values, flagged as supporting
    names = {m["name"]: m for m in out["measurements"]}
    assert names["Irregularly irregular R-R"]["value"] == "RR variance 0.31s"
    assert all(m["supports"] is True for m in out["measurements"])


def test_windows_from_beats_and_region_highlights_mirror_them():
    out = explain_finding(AF_FINDING, _ctx())  # no delineation -> beat-derived windows (beats + fs present)
    assert out["abnormalWindows"], "beats + fs should yield windows"
    # windows only on evidence leads, well-formed, reason tied to a criterion
    for w in out["abnormalWindows"]:
        assert w["lead"] in ("II", "V1")
        assert isinstance(w["startSample"], int) and isinstance(w["endSample"], int)
        assert 0 <= w["startSample"] < w["endSample"]
        assert w["reason"]
    # II beat 0.2s @ 500Hz = sample 100; half = int(0.06*500)=30 -> [70, 130]
    ii = next(w for w in out["abnormalWindows"] if w["lead"] == "II")
    assert ii["startSample"] == 70 and ii["endSample"] == 130
    # regionHighlights mirror the windows, labelled with the finding label
    assert len(out["regionHighlights"]) == len(out["abnormalWindows"])
    for r, w in zip(out["regionHighlights"], out["abnormalWindows"]):
        assert r["lead"] == w["lead"] and r["startSample"] == w["startSample"] and r["endSample"] == w["endSample"]
        assert r["label"] == "Atrial fibrillation"


def test_delineation_fiducials_take_precedence_over_beats():
    ctx = _ctx(delineation={"II": {"qrsOnset": [90, 590], "qrsOffset": [140, 640]}})
    out = explain_finding(AF_FINDING, ctx)
    ii = [w for w in out["abnormalWindows"] if w["lead"] == "II"]
    assert {"startSample": 90, "endSample": 140} == {"startSample": ii[0]["startSample"], "endSample": ii[0]["endSample"]}
    assert ii[1]["startSample"] == 590 and ii[1]["endSample"] == 640
    # a lead with no delineation entry (V1) still falls back to global beats
    assert any(w["lead"] == "V1" for w in out["abnormalWindows"])


def test_sparse_ctx_invents_nothing():
    out = explain_finding(AF_FINDING, {})  # no measurements/beats/fs/delineation/fusion
    assert out["abnormalWindows"] == [] and out["regionHighlights"] == []
    assert out["modelsAgreed"] == [] and out["modelsDisagreed"] == []
    # finding-derived fields are still populated (they need no ctx)
    assert out["leads"] == ["II", "V1"]
    assert out["rulesPassed"] and out["confidence"] == 0.82


def test_no_beats_means_no_windows_even_with_fs():
    ctx = _ctx(measurements={"heartRate": 128.0, "perLead": {}}, delineation=None)  # beats absent
    out = explain_finding(AF_FINDING, ctx)
    assert out["abnormalWindows"] == [] and out["regionHighlights"] == []


def test_unmatched_and_valueless_criteria_are_excluded():
    finding = {
        "id": "DX-X", "label": "Example", "confidence": 0.4,
        "criteria": [
            {"id": "C1", "description": "Matched with value", "measuredValue": "12 ms", "matched": True, "lead": "V2"},
            {"id": "C2", "description": "Unmatched criterion", "measuredValue": "99 ms", "matched": False, "lead": "V3"},
            {"id": "C3", "description": "Matched no value", "matched": True},
        ],
        "evidence": [{"lead": "V2", "ruleId": "C1", "measuredValue": "12 ms"}],
    }
    out = explain_finding(finding, {})
    # rulesPassed: only matched criteria (C1, C3), not the unmatched C2
    assert out["rulesPassed"] == ["Matched with value", "Matched no value"]
    # measurements: only criteria carrying a value (C1); C3 has none -> omitted, C2 unmatched -> supports False if present
    names = [m["name"] for m in out["measurements"]]
    assert "Matched with value" in names and "Matched no value" not in names
    # leads: only V2 (evidence + matched criterion C1); V3 is on an UNMATCHED criterion → excluded
    assert "V2" in out["leads"] and "V3" not in out["leads"]
    # why is built from matched criteria only
    assert "Matched with value" in out["why"] and "Unmatched criterion" not in out["why"]


def test_fusion_sources_split_by_agrees_flag():
    ctx = _ctx(fusion={"sources": [{"name": "rules", "agrees": True}, {"name": "torchecg", "agrees": False}]})
    out = explain_finding(AF_FINDING, ctx)
    assert out["modelsAgreed"] == ["rules"] and out["modelsDisagreed"] == ["torchecg"]


def test_fusion_disagreement_list_and_explicit_lists():
    # sources as names + a disagreement name list
    ctx = _ctx(fusion={"sources": ["rules", "torchecg", "gemini"], "disagreement": ["torchecg"]})
    out = explain_finding(AF_FINDING, ctx)
    assert out["modelsAgreed"] == ["rules", "gemini"] and out["modelsDisagreed"] == ["torchecg"]
    # explicit agreed/disagreed take precedence
    out2 = explain_finding(AF_FINDING, _ctx(fusion={"agreed": ["rules"], "disagreed": ["torchecg"]}))
    assert out2["modelsAgreed"] == ["rules"] and out2["modelsDisagreed"] == ["torchecg"]


def test_fusion_per_finding_override():
    ctx = _ctx(fusion={"agreed": ["rules"], "perFinding": {"DX-AF": {"agreed": ["rules", "torchecg"], "disagreed": ["gemini"]}}})
    out = explain_finding(AF_FINDING, ctx)
    assert out["modelsAgreed"] == ["rules", "torchecg"] and out["modelsDisagreed"] == ["gemini"]


def test_confidence_clamped_and_missing():
    assert explain_finding({"id": "x", "confidence": 1.7}, {})["confidence"] == 1.0
    assert explain_finding({"id": "x", "confidence": -0.5}, {})["confidence"] == 0.0
    assert explain_finding({"id": "x"}, {})["confidence"] == 0.0            # missing -> 0.0
    assert explain_finding({"id": "x", "confidence": "n/a"}, {})["confidence"] == 0.0  # non-numeric -> 0.0


def test_no_matched_criteria_yields_honest_why():
    out = explain_finding({"id": "DX-Z", "label": "Zeta", "confidence": 0.1, "criteria": []}, {})
    assert "no matched criteria" in out["why"]
    assert out["leads"] == [] and out["rulesPassed"] == [] and out["measurements"] == []


def test_invalid_finding_raises_typed_error():
    for bad in (None, "abc", 42, ["not", "a", "dict"]):
        with pytest.raises(KardioXError):
            explain_finding(bad, {})


def test_non_dict_ctx_is_tolerated():
    out = explain_finding(AF_FINDING, None)  # ctx coerced to {}
    assert out["leads"] == ["II", "V1"] and out["abnormalWindows"] == []
