import math
import pytest

from app.services.meta_analysis import MetaAnalysisError, calculate_meta_analysis

STUDIES = [
    {"study_id": "s1", "label": "Study 1", "effect": 0.70, "ci_lower": 0.50, "ci_upper": 0.98},
    {"study_id": "s2", "label": "Study 2", "effect": 0.80, "ci_lower": 0.60, "ci_upper": 1.06},
    {"study_id": "s3", "label": "Study 3", "effect": 0.65, "ci_lower": 0.42, "ci_upper": 1.01},
]


def test_random_effects_meta_analysis_returns_traceable_forest_data():
    out = calculate_meta_analysis(STUDIES, effect_measure="RR", model="random_dl")
    assert out["studiesIncluded"] == 3
    assert out["method"]["estimator"] == "DerSimonian-Laird"
    assert len(out["forestPlot"]["rows"]) == 3
    assert out["heterogeneity"]["q"] >= 0
    assert math.isfinite(out["pooled"]["effect"])
    assert out["provenance"]["inputStudyIds"] == ["s1", "s2", "s3"]


def test_fixed_effect_model():
    out = calculate_meta_analysis(STUDIES, effect_measure="RR", model="fixed")
    assert out["method"]["model"] == "fixed"
    assert out["heterogeneity"]["tauSquared"] == 0


def test_rejects_invalid_ratio_ci():
    bad = [dict(STUDIES[0], ci_lower=-0.2), STUDIES[1]]
    with pytest.raises(MetaAnalysisError):
        calculate_meta_analysis(bad, effect_measure="RR")


def test_requires_two_studies():
    with pytest.raises(MetaAnalysisError):
        calculate_meta_analysis(STUDIES[:1], effect_measure="OR")
