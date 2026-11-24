"""Unit tests for stats.survival with hand-checkable values.

KM fixture: times [1,2,3,4,5], events [1,0,1,1,0].
  t1: S = 4/5, Greenwood var(log S) = 1/(5*4) = 0.05
  t3: S = 8/15, var += 1/(3*2)
  t4: S = 4/15, var += 1/(2*1) = 0.5
  median 4 (S(3) = 0.533 > 0.5, S(4) = 0.267); lower band crosses 0.5 at 3,
  upper band never does (capped at 1) -> median CI upper null.
Log-rank fixture: group A events at [1,2,3], group B events at [4,5,6]:
  E_A = 0.5 + 0.4 + 0.25 = 1.15, V = 0.25 + 0.24 + 0.1875 = 0.6775,
  chisq = (3 - 1.15)^2 / 0.6775.
Cox fixture (no ties): times [1,2,3], events [1,1,0], x = [0,1,0]:
  the Efron/Breslow partial likelihood is maximised at exp(beta) = sqrt(2),
  information = 2 m (1 - m) with m = sqrt(2)/(2 + sqrt(2)).
"""
from __future__ import annotations

import math

import numpy as np
import pytest
from scipy.optimize import minimize
from scipy.stats import chi2, norm

from stats import IpdGateError, cox_ph, kaplan_meier, log_rank

C = {"ipdApproved": True, "evidenceId": "unit-test"}


def test_km_hand_computed():
    res = kaplan_meier([1, 2, 3, 4, 5], [1, 0, 1, 1, 0], compliance=C)
    steps = {s["time"]: s for s in res["steps"]}
    assert len(res["steps"]) == 5  # censoring-only times get flat steps
    assert steps[1]["nRisk"] == 5 and steps[1]["nEvent"] == 1 and steps[1]["nCensor"] == 0
    assert steps[2]["nRisk"] == 4 and steps[2]["nEvent"] == 0 and steps[2]["nCensor"] == 1
    assert steps[1]["surv"] == pytest.approx(0.8, abs=1e-12)
    assert steps[1]["se"] == pytest.approx(math.sqrt(0.05), abs=1e-12)
    assert steps[3]["surv"] == pytest.approx(8 / 15, abs=1e-12)
    assert steps[3]["se"] == pytest.approx(math.sqrt(0.05 + 1 / 6), abs=1e-12)
    assert steps[4]["surv"] == pytest.approx(4 / 15, abs=1e-12)
    assert steps[4]["se"] == pytest.approx(math.sqrt(0.05 + 1 / 6 + 0.5), abs=1e-12)
    z = norm.ppf(0.975)
    s3 = steps[3]
    assert s3["ciLower"] == pytest.approx(8 / 15 * math.exp(-z * s3["se"]), abs=1e-12)
    assert s3["ciUpper"] == pytest.approx(min(8 / 15 * math.exp(z * s3["se"]), 1.0), abs=1e-12)
    assert res["median"] == 4
    assert res["medianCiLower"] == 3
    assert res["medianCiUpper"] is None
    assert res["n"] == 5 and res["events"] == 3


def test_km_all_die_edge_has_null_se():
    res = kaplan_meier([1, 2], [1, 1], compliance=C)
    last = res["steps"][-1]
    assert last["surv"] == 0
    assert last["se"] is None
    assert last["ciLower"] is None and last["ciUpper"] is None


def test_logrank_hand_computed():
    t = [1, 2, 3, 4, 5, 6]
    e = [1, 1, 1, 1, 1, 1]
    g = ["A", "A", "A", "B", "B", "B"]
    res = log_rank(t, e, g, compliance=C)
    expect = (3 - 1.15) ** 2 / 0.6775
    assert res["chisq"] == pytest.approx(expect, abs=1e-10)
    assert res["df"] == 1
    assert res["p"] == pytest.approx(chi2.sf(expect, 1), abs=1e-12)
    a = res["groups"][0]
    assert a["group"] == "A" and a["n"] == 3
    assert a["observed"] == 3
    assert a["expected"] == pytest.approx(1.15, abs=1e-12)


def test_cox_no_ties_hand_computed():
    res = cox_ph([1, 2, 3], [1, 1, 0], {"x": [0.0, 1.0, 0.0]}, compliance=C)
    c = res["coefficients"][0]
    m = math.sqrt(2) / (2 + math.sqrt(2))
    info = 2 * m * (1 - m)
    assert c["coef"] == pytest.approx(math.log(math.sqrt(2)), abs=1e-8)
    assert c["se"] == pytest.approx(1 / math.sqrt(info), abs=1e-8)
    assert c["hr"] == pytest.approx(math.sqrt(2), abs=1e-8)
    z = c["coef"] / c["se"]
    assert c["p"] == pytest.approx(2 * norm.sf(abs(z)), abs=1e-10)
    assert res["events"] == 2
    assert res["phTest"]["global"]["df"] == 1


def _efron_loglik(beta, t, e, x):
    """Independent Efron partial likelihood (test-side implementation)."""
    t = np.asarray(t, float)
    e = np.asarray(e, float)
    x = np.asarray(x, float)
    ll = 0.0
    for time in np.unique(t[e == 1]):
        risk = t >= time
        deaths = (t == time) & (e == 1)
        d = int(deaths.sum())
        w = np.exp(beta * x)
        s0 = w[risk].sum()
        s0d = w[deaths].sum()
        ll += float((beta * x[deaths]).sum())
        for l in range(d):
            ll -= math.log(s0 - (l / d) * s0d)
    return ll


def test_cox_efron_ties_match_independent_optimizer():
    t = [1, 1, 2, 3, 3, 4]
    e = [1, 1, 1, 0, 1, 1]
    x = [0.5, 1.2, -0.3, 0.8, 1.5, -0.7]
    res = cox_ph(t, e, {"x": x}, compliance=C)
    opt = minimize(lambda b: -_efron_loglik(b[0], t, e, x), [0.0], method="Nelder-Mead",
                   options={"xatol": 1e-10, "fatol": 1e-12, "maxiter": 2000})
    assert res["coefficients"][0]["coef"] == pytest.approx(opt.x[0], abs=1e-6)
    # Efron must differ from Breslow on tied data (guards the ties path)
    b = res["coefficients"][0]["coef"]
    breslow_ll = 0.0
    tt, ee, xx = np.array(t, float), np.array(e, float), np.array(x, float)
    for time in np.unique(tt[ee == 1]):
        risk = tt >= time
        deaths = (tt == time) & (ee == 1)
        d = int(deaths.sum())
        w = np.exp(b * xx)
        breslow_ll += float((b * xx[deaths]).sum()) - d * math.log(w[risk].sum())
    assert _efron_loglik(b, t, e, x) > breslow_ll


def test_ph_test_shape_and_bounds():
    rng = np.random.default_rng(7)
    n = 120
    x = rng.normal(size=n)
    t = rng.exponential(scale=np.exp(-0.5 * x) * 10)
    e = (rng.random(n) < 0.8).astype(float)
    res = cox_ph(t.tolist(), e.tolist(), {"x": x.tolist()}, compliance=C)
    ph = res["phTest"]
    assert ph["transform"] == "km"
    assert ph["terms"][0]["term"] == "x"
    assert ph["terms"][0]["df"] == 1
    assert ph["global"]["df"] == 1
    for block in ph["terms"] + [ph["global"]]:
        assert block["chisq"] >= 0
        assert 0 <= block["p"] <= 1
        assert block["p"] == pytest.approx(chi2.sf(block["chisq"], block["df"]), abs=1e-12)


@pytest.mark.parametrize(
    "compliance",
    [None, {}, {"ipdApproved": False, "evidenceId": "e"}, {"ipdApproved": True},
     {"ipdApproved": True, "evidenceId": "  "}],
)
def test_ipd_gate_refuses(compliance):
    with pytest.raises(IpdGateError):
        kaplan_meier([1, 2], [1, 0], compliance=compliance)
    with pytest.raises(IpdGateError):
        log_rank([1, 2], [1, 1], ["A", "B"], compliance=compliance)
    with pytest.raises(IpdGateError):
        cox_ph([1, 2, 3], [1, 1, 0], {"x": [0.0, 1.0, 0.0]}, compliance=compliance)


def test_invalid_inputs():
    with pytest.raises(ValueError):
        kaplan_meier([1, 2], [1, 2], compliance=C)
    with pytest.raises(ValueError):
        kaplan_meier([1, 2], [0, 0], compliance=C)
    with pytest.raises(ValueError):
        log_rank([1, 2], [1, 1], ["A", "A"], compliance=C)
    with pytest.raises(ValueError):
        cox_ph([1, 2], [1, 1], {"x": [0.0, 1.0]}, compliance=C)  # n <= p
    with pytest.raises(ValueError):
        cox_ph([1, 2, 3], [1, 1, 0], {}, compliance=C)