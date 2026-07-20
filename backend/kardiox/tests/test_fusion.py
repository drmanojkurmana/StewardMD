"""Stage 12 — Evidence Fusion / Consensus Engine.

Pure Python: no ML dependencies, so these run everywhere (no importorskip needed). They pin the
medically meaningful behaviour: log-odds consensus rewards agreement, disagreement + low signal quality
gate confidence toward 0.5, empty candidates fall back to the rule engine, and confidence is never
absolute (clamped to [0.02, 0.98]).
"""
from __future__ import annotations

import pytest

from app.core.errors import BadImage
from app.services.fusion import fuse

_CLAMP_LO = 0.02
_CLAMP_HI = 0.98


def _validated_af(conf: float = 0.6, conflicts: list | None = None) -> dict:
    return {
        "matched": [{"ruleId": "RHY-AF-01", "title": "Irregularly irregular R-R", "detail": "RR variance",
                     "weight": 0.34, "severity": "urgent", "cluster": "af"}],
        "confidence": conf,
        "confidenceCapped": False,
        "conflicts": conflicts or [],
        "whatToVerify": "Confirm no flutter waves; correlate with pulse.",
        "diagnoses": [{
            "id": "DX-AF", "label": "Atrial fibrillation", "severity": "urgent", "confidence": conf,
            "criteria": [{"id": "RHY-AF-01", "description": "Irregularly irregular R-R",
                          "measuredValue": "", "weight": 0.34, "matched": True}],
            "differentials": [{"label": "Atrial flutter (variable block)", "probability": 0.06}],
            "whatToVerify": "Confirm rhythm.", "evidence": [],
        }],
    }


def test_agreeing_sources_plus_rule_concordance_are_confident():
    cands = [
        {"source": "model-a", "label": "Atrial fibrillation", "confidence": 0.85, "weight": 1.0},
        {"source": "model-b", "label": "AF", "confidence": 0.80, "weight": 1.0},          # alias -> same group
        {"source": "rules", "label": "atrial fibrillation", "confidence": 0.70, "weight": 1.0},
    ]
    out = fuse(cands, _validated_af())
    assert out["method"] == "logodds-consensus"
    assert out["topLabel"] == "Atrial fibrillation"
    top = out["findings"][0]
    assert top["agreement"] == 1.0                 # all three sources agree
    assert top["ruleConcordance"] == 1.0           # rule engine supports it
    assert top["fusedConfidence"] >= 0.8           # consensus is high...
    assert top["fusedConfidence"] <= 0.98          # ...but never absolute
    assert top["disagreement"] == []               # nobody dissents
    assert sorted(top["sources"]) == ["model-a", "model-b", "rules"]


def test_disagreement_lowers_confidence_and_warns():
    cands = [
        {"source": "a", "label": "Atrial fibrillation", "confidence": 0.70},
        {"source": "b", "label": "Atrial flutter", "confidence": 0.65},
        {"source": "c", "label": "Sinus rhythm", "confidence": 0.60},
    ]
    out = fuse(cands, _validated_af())
    agree = fuse([
        {"source": "a", "label": "Atrial fibrillation", "confidence": 0.70},
        {"source": "b", "label": "AF", "confidence": 0.65},
        {"source": "c", "label": "atrial fibrillation", "confidence": 0.60},
    ], _validated_af())["findings"][0]["fusedConfidence"]

    top = out["findings"][0]
    assert top["label"] == "Atrial fibrillation"          # rule concordance keeps AF on top
    assert top["fusedConfidence"] < agree                 # split vote is less confident than a clean sweep
    assert top["disagreement"]                            # rival labels are listed
    assert any("Atrial flutter" in d for d in top["disagreement"])
    assert any("disagree" in w for w in out["warnings"])


def test_low_signal_quality_pulls_confidence_toward_half():
    cands = [
        {"source": "a", "label": "Atrial fibrillation", "confidence": 0.85},
        {"source": "b", "label": "AF", "confidence": 0.80},
        {"source": "c", "label": "atrial fibrillation", "confidence": 0.70},
    ]
    hi = fuse(cands, _validated_af(), signal_quality=1.0)["findings"][0]["fusedConfidence"]
    low_out = fuse(cands, _validated_af(), signal_quality=0.1)
    lo = low_out["findings"][0]["fusedConfidence"]

    assert lo < hi
    assert abs(lo - 0.5) < abs(hi - 0.5)                  # gated toward the non-committal midpoint
    assert any("signal quality" in w for w in low_out["warnings"])
    assert low_out["findings"][0]["factors"]["signalQuality"] == 0.1


def test_empty_candidates_fall_back_to_rule_diagnoses():
    out = fuse([], _validated_af(conf=0.55))
    assert out["findings"], "expected findings derived from the rule engine"
    assert out["topLabel"] == "Atrial fibrillation"
    top = out["findings"][0]
    assert top["sources"] == ["rule-engine"]
    assert top["ruleConcordance"] == 1.0
    assert top["fusedConfidence"] == pytest.approx(0.55, abs=1e-6)   # rule confidence, quality neutral
    assert any("rule engine" in w for w in out["warnings"])


def test_confidence_never_exceeds_bounds():
    high = fuse([{"source": "a", "label": "AF", "confidence": 0.999, "weight": 50.0}], _validated_af())
    low = fuse([{"source": "a", "label": "Widget artifact", "confidence": 0.0001, "weight": 50.0}],
               {"diagnoses": [], "conflicts": []})
    for out in (high, low):
        for f in out["findings"]:
            assert _CLAMP_LO <= f["fusedConfidence"] <= _CLAMP_HI
        assert _CLAMP_LO <= out["overallConfidence"] <= _CLAMP_HI
    assert high["findings"][0]["fusedConfidence"] <= 0.98      # extreme + heavy weight still capped
    assert low["findings"][0]["fusedConfidence"] >= 0.02       # near-zero still floored


def test_bad_input_types_raise():
    with pytest.raises(BadImage):
        fuse("not a list", _validated_af())              # type: ignore[arg-type]
    with pytest.raises(BadImage):
        fuse([], "not a dict")                           # type: ignore[arg-type]


def test_none_inputs_are_safe_defaults():
    out = fuse(None, None)                               # type: ignore[arg-type]
    assert out["findings"] == []
    assert out["topLabel"] is None
    assert out["overallConfidence"] == 0.0
    assert out["method"] == "logodds-consensus"
