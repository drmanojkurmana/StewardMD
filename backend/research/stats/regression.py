"""Phase 5D.2 regression models, canonical for ResearchMD.

Linear regression (OLS, optional HC3 robust covariance) and logistic
regression (binomial GLM, MLE by IRLS). Reference calls pinned for R parity
(scripts/research-parity-5d.R): lm(y ~ x1 + x2) and
glm(y ~ x1 + x2, family = binomial) on mtcars. OLS inference uses the t
distribution on n - k df (as lm); logistic inference uses the normal (as glm).
The reported OLS AIC counts the residual variance as a parameter, matching
R's AIC(lm) exactly (statsmodels' own aic is 2 lower).

IPD rule (5C.3): every function refuses to run without the compliance flag
{"ipdApproved": True, "evidenceId": ...}. There is no LLM call in this
package; patient-level rows never reach an LLM and never leave the worker
process. Only coefficients and a data hash are returned.
"""
from __future__ import annotations

import math

import numpy as np
import statsmodels.api as sm
from scipy.stats import t as t_dist

from ._common import (
    __version__,
    check_columns,
    model_manifest,
    require_ipd_approval,
    z_value,
)


def parse_formula(formula: str) -> tuple[str, list[str]]:
    """Minimal formula parser: 'y ~ x1 + x2' or 'y ~ 1' (intercept only).

    Only additive numeric terms are supported (no interactions, transforms or
    '- 1'); anything else raises ValueError so a spec can never be silently
    misread.
    """
    if not isinstance(formula, str) or formula.count("~") != 1:
        raise ValueError("invalid_formula")
    lhs, rhs = formula.split("~")
    y = lhs.strip()
    terms = [] if rhs.strip() == "1" else [t.strip() for t in rhs.split("+")]
    if not y or any(not t for t in terms):
        raise ValueError("invalid_formula")
    if len(set(terms)) != len(terms) or y in terms:
        raise ValueError("invalid_formula")
    for name in [y] + terms:
        if not name.replace("_", "").isalnum():
            raise ValueError("invalid_formula")
    return y, terms


def _design(columns: dict, y_name: str, x_names: list[str]):
    arrays = check_columns(columns, [y_name] + x_names)
    y = arrays[y_name]
    n = len(y)
    k = len(x_names) + 1
    if n <= k:
        raise ValueError("too_few_rows")
    X = np.column_stack([np.ones(n)] + [arrays[name] for name in x_names])
    return y, X, arrays


def _coef_record(term, est, se, stat, p, lo, hi, stat_name):
    return {
        "term": term,
        "estimate": float(est),
        "se": float(se),
        stat_name: float(stat),
        "p": float(p),
        "ciLower": float(lo),
        "ciUpper": float(hi),
    }


def linear_regression(
    columns: dict,
    formula: str,
    *,
    compliance: dict,
    robust: str | None = None,
    level: float = 0.95,
) -> dict:
    """OLS with t-based inference; robust='HC3' swaps in the HC3 covariance.

    HC3 (MacKinnon-White): V = (X'X)^-1 X' diag(e_i^2 / (1 - h_ii)^2) X (X'X)^-1.
    With robust='HC3' the SEs, t, p and CI use that covariance (t on n - k df);
    estimates, sigma, R2 and AIC are unchanged. Parity pins lm plus the HC3 SEs
    computed from the hat matrix in R.
    """
    require_ipd_approval(compliance)
    if robust not in (None, "HC3"):
        raise ValueError("invalid_robust")
    y_name, x_names = parse_formula(formula)
    y, X, arrays = _design(columns, y_name, x_names)
    n, k = X.shape
    fit = sm.OLS(y, X).fit(cov_type="HC3") if robust else sm.OLS(y, X).fit()
    z = z_value(level)  # validates level; OLS CI uses t below
    crit = float(t_dist.ppf((1 + level) / 2, n - k))
    terms = ["Intercept"] + x_names
    coefs = []
    for j, term in enumerate(terms):
        est = float(fit.params[j])
        se = float(fit.bse[j])
        coefs.append(
            _coef_record(
                term, est, se, est / se, fit.pvalues[j],
                est - crit * se, est + crit * se, "t",
            )
        )
    ssr = float(fit.ssr)
    # R AIC(lm) counts sigma: -2 logLik + 2 (k + 1).
    aic = n * (math.log(2 * math.pi) + math.log(ssr / n) + 1) + 2 * (k + 1)
    spec = {"family": "linear", "formula": formula, "robust": robust, "level": level}
    return {
        "family": "linear",
        "formula": formula,
        "robust": robust,
        "level": level,
        "coefficients": coefs,
        "n": n,
        "dfResidual": n - k,
        "sigma": math.sqrt(ssr / (n - k)),
        "r2": float(fit.rsquared),
        "aic": aic,
        "manifest": model_manifest(spec, {c: arrays[c].tolist() for c in [y_name] + x_names}, n, __version__),
    }


def logistic_regression(
    columns: dict,
    formula: str,
    *,
    compliance: dict,
    level: float = 0.95,
) -> dict:
    """Binomial GLM (logit link), MLE by IRLS; normal-based inference as glm.

    The outcome must be 0/1. Separation or non-convergence raises
    ValueError('logistic_not_converged') rather than reporting infinite SEs.
    """
    require_ipd_approval(compliance)
    y_name, x_names = parse_formula(formula)
    y, X, arrays = _design(columns, y_name, x_names)
    if not np.all((y == 0) | (y == 1)):
        raise ValueError("outcome_not_binary")
    if y.sum() == 0 or y.sum() == len(y):
        raise ValueError("outcome_constant")
    fit = sm.GLM(y, X, family=sm.families.Binomial()).fit(tol=1e-12, maxiter=200)
    if not getattr(fit, "converged", True):
        raise ValueError("logistic_not_converged")
    z = z_value(level)
    terms = ["Intercept"] + x_names
    coefs = []
    for j, term in enumerate(terms):
        est = float(fit.params[j])
        se = float(fit.bse[j])
        if not math.isfinite(se) or se > 1e6:
            raise ValueError("logistic_not_converged")
        coefs.append(
            _coef_record(
                term, est, se, est / se, fit.pvalues[j],
                est - z * se, est + z * se, "z",
            )
        )
    spec = {"family": "logistic", "formula": formula, "level": level}
    return {
        "family": "logistic",
        "formula": formula,
        "level": level,
        "coefficients": coefs,
        "n": len(y),
        "aic": float(fit.aic),
        "deviance": float(fit.deviance),
        "nullDeviance": float(fit.null_deviance),
        "iterations": int(fit.fit_history["iteration"]),
        "manifest": model_manifest(spec, {c: arrays[c].tolist() for c in [y_name] + x_names}, len(y), __version__),
    }