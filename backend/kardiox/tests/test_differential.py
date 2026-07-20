"""Clinical Differential Diagnosis Engine — ranked differentials, uncertainty, nearest-pattern fallback.

Pure Python (no ML deps) — runs in the base CI 'test' job. Verifies it NEVER fabricates: evidence strings
come only from provided criteria/measurements/quality, and confidences come from the fusion/rule inputs.
"""
from __future__ import annotations

from app.services.differential import build_differential, source_weight

_VALIDATED = {
    "confidence": 0.82, "confidenceCapped": False, "conflicts": [],
    "matched": [{"ruleId": "RHY-AF-01", "title": "Irregularly irregular R-R", "detail": "RR variance 0.31s",
                 "weight": 0.34, "severity": "urgent", "cluster": "af"}],
    "diagnoses": [{"id": "DX-AF", "label": "Atrial fibrillation", "severity": "urgent", "confidence": 0.82,
                   "criteria": [{"id": "RHY-AF-01", "description": "Irregularly irregular R-R",
                                 "measuredValue": "RR variance 0.31s"}],
                   "differentials": [{"label": "Atrial flutter", "probability": 0.06}],
                   "whatToVerify": "Confirm no flutter waves in inferior leads."}],
}
_CONSENSUS = {"findings": [{"label": "Atrial fibrillation", "fusedConfidence": 0.82, "sources": ["rules"],
                            "agreement": 1.0, "ruleConcordance": 1.0, "disagreement": []}],
              "topLabel": "Atrial fibrillation", "overallConfidence": 0.82, "method": "logodds-consensus",
              "warnings": []}
_MEAS = {"heartRate": 128, "qrsMs": 92, "qtcMs": 468, "axisDeg": 42}


def test_ranked_primary_with_supporting_and_conflicting():
    out = build_differential(_VALIDATED, _CONSENSUS, _MEAS, {"perLead": {}, "territory": None},
                             signal_quality=0.9)
    assert out["primary"]["label"] == "Atrial fibrillation"
    assert out["primary"]["confidence"] == 0.82
    assert any("Irregularly irregular" in s for s in out["primary"]["supporting"])
    assert any("128 bpm" in s for s in out["primary"]["supporting"])
    # borderline QTc 468 surfaces as conflicting evidence (real, from measurements)
    assert any("QTc" in s for s in out["primary"]["conflicting"])
    assert out["disclaimer"].lower().count("not a diagnosis") == 1


def test_low_quality_drives_uncertainty_and_recommendations_not_rejection():
    out = build_differential(_VALIDATED, _CONSENSUS, _MEAS, {"perLead": {}, "territory": "inferior"},
                             quality_report={"gate": "warn", "reasons": ["image is blurry (out of focus)"]},
                             signal_quality=0.3)
    # never rejects — still returns a primary + differentials
    assert out["primary"] is not None
    assert out["uncertainty"]["isUncertain"] is True
    assert any("quality" in r.lower() for r in out["uncertainty"]["reasons"])
    recs = " ".join(out["uncertainty"]["recommendations"]).lower()
    assert "repeat" in recs and "correlate clinically" in recs
    assert "additional leads" in recs                      # inferior territory → posterior/right-sided
    assert out["cardiologistReviewRecommended"] is True


def test_disagreement_is_shown_not_hidden():
    consensus = {"findings": [{"label": "Atrial fibrillation", "fusedConfidence": 0.55, "sources": ["rules", "torchecg"],
                               "agreement": 0.5, "disagreement": ["torchecg: atrial flutter"]}],
                 "overallConfidence": 0.55, "warnings": ["sources disagree"]}
    out = build_differential(_VALIDATED, consensus, _MEAS, {"perLead": {}, "territory": None}, signal_quality=0.9)
    assert any("disagree" in c.lower() for c in out["primary"]["conflicting"])
    assert out["cardiologistReviewRecommended"] is True


def test_nearest_pattern_fallback_when_no_findings():
    # no rule diagnoses + no fused findings → nearest electrophysiological pattern, clearly a differential
    out = build_differential({"diagnoses": [], "matched": []}, {"findings": []}, {"heartRate": 130, "qrsMs": 90},
                             {"perLead": {}, "territory": None},
                             rhythm={"rateBpm": 130, "regularity": "regular"}, morphology={"pWaves": "present"})
    assert out["patternBased"] is True
    assert out["primary"] is not None
    assert out["uncertainty"]["level"] == "high"
    assert out["cardiologistReviewRecommended"] is True
    assert any("differential, not definitive" in d["why"] for d in out["differentials"])


def test_source_weight_reliability_ordering():
    # rules/measurement (validated deterministic) outweigh un-fine-tuned foundation encoders
    assert source_weight("rules") > source_weight("ecglib") >= source_weight("ecg-fm")
    assert source_weight("measurement") > source_weight("heartgpt")
    assert source_weight("unknown-src") == 0.4       # honest default


def test_never_fabricates_with_empty_inputs():
    out = build_differential({}, None, {}, {})
    # no evidence at all → no primary, high uncertainty, review recommended; nothing invented
    assert out["primary"] is None
    assert out["differentials"] == []
    assert out["cardiologistReviewRecommended"] is True
