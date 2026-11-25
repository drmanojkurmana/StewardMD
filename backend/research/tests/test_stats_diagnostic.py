"""Unit tests for stats.diagnostic: the stated 0.5 correction rules and
hand-checkable Reitsma limits. Accuracy against mada::reitsma is pinned by
test_stats_parity.py (AuditC, Dementia).
"""
from __future__ import annotations

import math

import pytest
from scipy.special import expit, logit

from stats import IpdGateError, per_study_accuracy, reitsma

C = {"ipdApproved": True, "evidenceId": "unit-test"}


def _study(tp, fn, fp, tn, sid="s"):
    return {"id": sid, "TP": tp, "FN": fn, "FP": fp, "TN": tn}


def test_correction_single_only_touches_zero_studies():
    studies = [_study(10, 0, 5, 85, "a"), _study(8, 2, 2, 8, "b")]
    res = per_study_accuracy(studies, compliance=C, correction_control="single")
    a, b = res["studies"]
    assert res["correctionApplied"] is True
    assert (a["tp"], a["fn"], a["fp"], a["tn"]) == (10.5, 0.5, 5.5, 85.5)
    assert a["sens"] == pytest.approx(10.5 / 11, abs=1e-12)
    assert a["spec"] == pytest.approx(85.5 / 91, abs=1e-12)
    assert (b["tp"], b["fn"], b["fp"], b["tn"]) == (8, 2, 2, 8)
    assert b["sens"] == pytest.approx(0.8, abs=1e-12)


def test_correction_all_touches_every_study_when_any_zero():
    studies = [_study(10, 0, 5, 85, "a"), _study(8, 2, 2, 8, "b")]
    res = per_study_accuracy(studies, compliance=C, correction_control="all")
    a, b = res["studies"]
    assert a["sens"] == pytest.approx(10.5 / 11, abs=1e-12)
    assert b["tp"] == 8.5 and b["fn"] == 2.5
    assert b["sens"] == pytest.approx(8.5 / 11, abs=1e-12)


def test_correction_none_refuses_zero_cells():
    with pytest.raises(ValueError, match="zero_cell"):
        per_study_accuracy([_study(10, 0, 5, 85)], compliance=C, correction_control="none")
    res = per_study_accuracy([_study(10, 2, 5, 85)], compliance=C, correction_control="none")
    assert res["correctionApplied"] is False
    assert res["studies"][0]["sens"] == pytest.approx(10 / 12, abs=1e-12)


def test_no_zero_cells_means_no_correction():
    res = per_study_accuracy([_study(8, 2, 2, 8)], compliance=C)
    assert res["correctionApplied"] is False
    assert res["studies"][0]["sens"] == pytest.approx(0.8, abs=1e-12)
    assert res["studies"][0]["spec"] == pytest.approx(0.8, abs=1e-12)


def test_reitsma_identical_studies_pool_to_common_value():
    studies = [_study(8, 2, 2, 8, f"s{i}") for i in range(3)]
    res = reitsma(studies, compliance=C)
    assert res["pooledSens"] == pytest.approx(0.8, abs=1e-3)
    assert res["pooledSpec"] == pytest.approx(0.8, abs=1e-3)
    assert res["coefficients"][0]["estimate"] == pytest.approx(logit(0.8), abs=1e-3)
    assert max(abs(v) for row in res["psi"] for v in row) < 1e-2
    # no between-study variance -> Rutter-Gatsonis curve undefined
    assert res["sroc"]["ruttergatsonis"] is None


def test_reitsma_large_counts_approach_inverse_variance_pooling():
    # Nearly identical studies (sens 0.80 vs 0.79) with large counts: no
    # heterogeneity, so the pooled logit is the inverse-variance weighted mean.
    studies = [_study(800, 200, 200, 800, "a"), _study(790, 210, 200, 800, "b")]
    res = reitsma(studies, compliance=C)
    y1, y2 = logit(0.8), logit(0.79)
    v1 = 1 / 800 + 1 / 200
    v2 = 1 / 790 + 1 / 210
    expect = (y1 / v1 + y2 / v2) / (1 / v1 + 1 / v2)
    assert res["coefficients"][0]["estimate"] == pytest.approx(expect, abs=2e-3)
    assert res["pooledSens"] == pytest.approx(expit(expect), abs=2e-3)


def test_reitsma_sroc_curves_pass_through_pooled_point():
    studies = [_study(47, 9, 101, 738, "a"), _study(126, 51, 272, 1543, "b"),
               _study(19, 10, 12, 192, "c"), _study(30, 5, 40, 200, "d")]
    res = reitsma(studies, compliance=C)
    fpr = res["pooledFpr"]
    # both curves pass through (pooled FPR, pooled sens) by construction
    naive = res["sroc"]["naive"]
    idx = min(range(99), key=lambda i: abs(res["sroc"]["fpr"][i] - fpr))
    assert naive[idx] == pytest.approx(res["pooledSens"], abs=0.02)
    assert res["psi"][0][1] == res["psi"][1][0]
    assert res["psi"][0][0] >= 0 and res["psi"][1][1] >= 0


@pytest.mark.parametrize(
    "compliance",
    [None, {}, {"ipdApproved": False, "evidenceId": "e"}, {"ipdApproved": True},
     {"ipdApproved": True, "evidenceId": ""}],
)
def test_ipd_gate_refuses(compliance):
    with pytest.raises(IpdGateError):
        per_study_accuracy([_study(8, 2, 2, 8)], compliance=compliance)
    with pytest.raises(IpdGateError):
        reitsma([_study(8, 2, 2, 8, "a"), _study(7, 3, 3, 7, "b")], compliance=compliance)


def test_invalid_inputs():
    with pytest.raises(ValueError):
        per_study_accuracy([], compliance=C)
    with pytest.raises(ValueError):
        per_study_accuracy([_study(-1, 2, 2, 8)], compliance=C)
    with pytest.raises(ValueError):
        per_study_accuracy([_study(8, 2, 2, 8)], compliance=C, correction_control="bogus")
    with pytest.raises(ValueError):
        reitsma([_study(8, 2, 2, 8)], compliance=C)  # needs >= 2 studies