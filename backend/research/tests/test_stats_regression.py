"""Unit tests for stats.regression with hand-checkable values.

The OLS fixture x = [1,2,3,4], y = [2,4,5,4] has closed-form answers:
Sxx = 5, Sxy = 3.5, slope 0.7, intercept 2.0, RSS 2.3, sigma^2 = 1.15,
se(slope) = sqrt(0.23), se(intercept) = sqrt(1.725), df 2.
The intercept-only logistic fixture y = [1,0,1,1,0,1] gives
beta = logit(2/3) = log 2, se = 1/sqrt(n p (1-p)) = sqrt(3)/2.
"""
from __future__ import annotations

import math

import numpy as np
import pytest
from scipy.stats import t as t_dist

from stats import IpdGateError, linear_regression, logistic_regression

C = {"ipdApproved": True, "evidenceId": "unit-test"}
COLS = {"x": [1.0, 2.0, 3.0, 4.0], "y": [2.0, 4.0, 5.0, 4.0]}


def test_ols_hand_computed():
    res = linear_regression(COLS, "y ~ x", compliance=C)
    by_term = {c["term"]: c for c in res["coefficients"]}
    assert res["n"] == 4
    assert res["dfResidual"] == 2
    assert by_term["Intercept"]["estimate"] == pytest.approx(2.0, abs=1e-12)
    assert by_term["x"]["estimate"] == pytest.approx(0.7, abs=1e-12)
    assert by_term["x"]["se"] == pytest.approx(math.sqrt(0.23), abs=1e-12)
    assert by_term["Intercept"]["se"] == pytest.approx(math.sqrt(1.725), abs=1e-12)
    assert res["sigma"] == pytest.approx(math.sqrt(1.15), abs=1e-12)
    t_slope = 0.7 / math.sqrt(0.23)
    assert by_term["x"]["t"] == pytest.approx(t_slope, abs=1e-10)
    assert by_term["x"]["p"] == pytest.approx(2 * t_dist.sf(t_slope, 2), abs=1e-12)
    crit = t_dist.ppf(0.975, 2)
    assert by_term["x"]["ciLower"] == pytest.approx(0.7 - crit * math.sqrt(0.23), abs=1e-10)
    assert by_term["x"]["ciUpper"] == pytest.approx(0.7 + crit * math.sqrt(0.23), abs=1e-10)
    # R-style AIC counts sigma: n (log 2pi + log(RSS/n) + 1) + 2 (k + 1)
    expect_aic = 4 * (math.log(2 * math.pi) + math.log(2.3 / 4) + 1) + 2 * 3
    assert res["aic"] == pytest.approx(expect_aic, abs=1e-10)


def test_hc3_matches_independent_hat_matrix_computation():
    res = linear_regression(COLS, "y ~ x", compliance=C, robust="HC3")
    x = np.array(COLS["x"])
    y = np.array(COLS["y"])
    X = np.column_stack([np.ones(4), x])
    beta = np.linalg.lstsq(X, y, rcond=None)[0]
    e = y - X @ beta
    h = np.einsum("ij,jk,ik->i", X, np.linalg.inv(X.T @ X), X)
    u = e / (1 - h)
    bread = np.linalg.inv(X.T @ X)
    V = bread @ (X.T @ np.diag(u**2) @ X) @ bread
    for got, want in zip(res["coefficients"], np.sqrt(np.diag(V))):
        assert got["se"] == pytest.approx(want, abs=1e-10)
    # HC3 changes SEs, not estimates
    plain = linear_regression(COLS, "y ~ x", compliance=C)
    for a, b in zip(res["coefficients"], plain["coefficients"]):
        assert a["estimate"] == pytest.approx(b["estimate"], abs=1e-12)


def test_logistic_intercept_only_hand_computed():
    # p = 4/6: beta = logit(2/3) = log 2, se = 1/sqrt(n p (1-p)) = sqrt(3)/2
    cols = {"y": [1.0, 0.0, 1.0, 1.0, 0.0, 1.0]}
    res = logistic_regression(cols, "y ~ 1", compliance=C)
    assert res["n"] == 6
    c0 = res["coefficients"][0]
    assert c0["estimate"] == pytest.approx(math.log(2), abs=1e-8)
    assert c0["se"] == pytest.approx(math.sqrt(3) / 2, abs=1e-8)
    # deviance = -2 (4 log(2/3) + 2 log(1/3))
    expect_dev = -2 * (4 * math.log(2 / 3) + 2 * math.log(1 / 3))
    assert res["deviance"] == pytest.approx(expect_dev, abs=1e-8)


def test_logistic_score_equations_at_mle():
    # every x level has both outcomes: the MLE is finite (no separation)
    cols = {"x": [0.0, 0.0, 1.0, 1.0, 2.0, 2.0], "y": [0.0, 1.0, 0.0, 1.0, 1.0, 0.0]}
    res = logistic_regression(cols, "y ~ x", compliance=C)
    b0 = res["coefficients"][0]["estimate"]
    b1 = res["coefficients"][1]["estimate"]
    x = np.array(cols["x"])
    y = np.array(cols["y"])
    p = 1 / (1 + np.exp(-(b0 + b1 * x)))
    assert abs(float(np.sum(y - p))) < 1e-7
    assert abs(float(np.sum((y - p) * x))) < 1e-7


def test_manifest_records_formula_hash_and_versions():
    a = linear_regression(COLS, "y ~ x", compliance=C)
    b = linear_regression(COLS, "y ~ x", compliance=C)
    m = a["manifest"]
    assert m["engine"] == "research-stats"
    assert m["model"]["formula"] == "y ~ x"
    assert m["n"] == 4
    assert len(m["dataHash"]) == 64
    assert m["dataHash"] == b["manifest"]["dataHash"]
    for pkg in ("python", "numpy", "scipy", "statsmodels"):
        assert m["packages"][pkg]
    changed = dict(COLS, y=[2.0, 4.0, 5.0, 5.0])
    c = linear_regression(changed, "y ~ x", compliance=C)
    assert c["manifest"]["dataHash"] != m["dataHash"]


@pytest.mark.parametrize(
    "compliance",
    [None, {}, {"ipdApproved": False, "evidenceId": "e"}, {"ipdApproved": True},
     {"ipdApproved": True, "evidenceId": ""}, {"ipdApproved": "true", "evidenceId": "e"}],
)
def test_ipd_gate_refuses(compliance):
    with pytest.raises(IpdGateError):
        linear_regression(COLS, "y ~ x", compliance=compliance)
    with pytest.raises(IpdGateError):
        logistic_regression({"x": [0.0] * 6, "y": [1.0, 0.0, 1.0, 1.0, 0.0, 1.0]}, "y ~ x", compliance=compliance)


def test_invalid_inputs():
    with pytest.raises(ValueError):
        linear_regression(COLS, "y ~ x + x", compliance=C)
    with pytest.raises(ValueError):
        linear_regression(COLS, "y ~", compliance=C)
    with pytest.raises(ValueError):
        linear_regression({"x": [1.0, 2.0], "y": [1.0, 2.0]}, "y ~ x", compliance=C)
    with pytest.raises(ValueError):
        linear_regression({"x": [1.0, float("nan")], "y": [1.0, 2.0]}, "y ~ x", compliance=C)
    with pytest.raises(ValueError):
        linear_regression(COLS, "y ~ x", compliance=C, robust="HC0")
    with pytest.raises(ValueError):
        logistic_regression({"x": [0.0, 1.0], "y": [0.5, 1.0]}, "y ~ x", compliance=C)
    with pytest.raises(ValueError):
        logistic_regression({"x": [0.0, 1.0], "y": [1.0, 1.0]}, "y ~ x", compliance=C)