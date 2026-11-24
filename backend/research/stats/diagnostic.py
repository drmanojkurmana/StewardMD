"""Phase 5D.3 diagnostic accuracy, canonical for ResearchMD.

Per-study sensitivity/specificity and the Reitsma bivariate random-effects
model for pooled sensitivity and specificity, with SROC curves. Reference
call pinned for R parity: mada::reitsma (mada 0.5.12, mvmeta 1.0.3 REML) on
mada's own AuditC and Dementia data, plus mada::sroc types "ruttergatsonis"
(default) and "naive".

0.5 correction rules (mada::reitsma defaults correction = 0.5,
correction.control = "all"), stated explicitly:
- "all": if ANY cell of ANY study is zero, add 0.5 to ALL four cells of
  EVERY study (mada's default; this is what the parity fixtures use).
- "single": add 0.5 to all four cells of each study that has a zero cell;
  studies with no zero cell are untouched.
- "none": no correction; a zero cell raises ValueError('zero_cell') because
  the logit is undefined.
After correction, sens = TP/(TP+FN), spec = TN/(FP+TN), and the within-study
variances on the logit scale are 1/TP + 1/FN and 1/FP + 1/TN.

The bivariate model pools (logit sens, logit FPR) with a diagonal
within-study covariance and an unstructured between-study covariance Psi,
estimated by REML (profiled likelihood, Cholesky parameterisation, BFGS),
matching mvmeta's method. Pooled specificity is 1 - pooled FPR. The
Rutter-Gatsonis SROC curve uses Lambda and beta derived from Psi exactly as
mada::calc_hsroc_coef; the naive curve is the conditional mean
logit(sens) = mu1 + (Psi12/Psi22) (logit(fpr) - mu2).

IPD rule (5C.3): every function refuses to run without the compliance flag
{"ipdApproved": True, "evidenceId": ...}. There is no LLM call in this
package; rows never reach an LLM and never leave the worker process.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit, logit
from scipy.stats import norm

from ._common import __version__, model_manifest, require_ipd_approval, z_value

_CELL_NAMES = ("TP", "FN", "FP", "TN")


def _validate_studies(studies):
    if not isinstance(studies, (list, tuple)) or len(studies) == 0:
        raise ValueError("studies must be a non-empty list")
    out = []
    for i, s in enumerate(studies):
        if not isinstance(s, dict):
            raise ValueError("each study must be an object")
        counts = {}
        for name in _CELL_NAMES:
            v = s.get(name)
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v < 0:
                raise ValueError(f"study {i}: {name} must be a non-negative number")
            counts[name] = float(v)
        out.append({"id": s.get("id", f"study-{i + 1}"), **counts})
    return out


def _apply_correction(studies, correction: float, control: str):
    if control not in ("all", "single", "none"):
        raise ValueError("invalid_correction_control")
    if not math.isfinite(correction) or correction < 0:
        raise ValueError("invalid_correction")
    any_zero = any(s[name] == 0 for s in studies for name in _CELL_NAMES)
    if control == "none":
        if any_zero:
            raise ValueError("zero_cell")
        return [dict(s) for s in studies], False
    if control == "all":
        if not any_zero:
            return [dict(s) for s in studies], False
        return [{**s, **{name: s[name] + correction for name in _CELL_NAMES}} for s in studies], True
    corrected = []
    touched = False
    for s in studies:
        if any(s[name] == 0 for name in _CELL_NAMES):
            corrected.append({**s, **{name: s[name] + correction for name in _CELL_NAMES}})
            touched = True
        else:
            corrected.append(dict(s))
    return corrected, touched


def per_study_accuracy(
    studies,
    *,
    compliance: dict,
    correction: float = 0.5,
    correction_control: str = "all",
) -> dict:
    """Per-study sensitivity and specificity with the stated 0.5 rules."""
    require_ipd_approval(compliance)
    raw = _validate_studies(studies)
    corrected, applied = _apply_correction(raw, correction, correction_control)
    rows = []
    for s in corrected:
        n_pos = s["TP"] + s["FN"]
        n_neg = s["FP"] + s["TN"]
        if n_pos <= 0 or n_neg <= 0:
            raise ValueError("zero_marginal")
        rows.append(
            {
                "id": s["id"],
                "tp": s["TP"],
                "fn": s["FN"],
                "fp": s["FP"],
                "tn": s["TN"],
                "sens": s["TP"] / n_pos,
                "spec": s["TN"] / n_neg,
            }
        )
    spec = {
        "family": "diagnostic",
        "model": "per-study",
        "correction": correction,
        "correctionControl": correction_control,
    }
    return {
        "family": "diagnostic",
        "model": "per-study",
        "correction": correction,
        "correctionControl": correction_control,
        "correctionApplied": applied,
        "k": len(rows),
        "studies": rows,
        "manifest": model_manifest(spec, raw, len(rows), __version__),
    }


def _reml_profile(theta, y, S):
    """Negative profiled REML log-likelihood (mvmeta remlprof.fn equivalent)."""
    L = np.array([[theta[0], 0.0], [theta[1], theta[2]]])
    psi = L @ L.T
    V = S + psi
    m = len(y)
    try:
        chol = np.linalg.cholesky(V)
    except np.linalg.LinAlgError:
        return 1e12
    logdet_v = 2.0 * np.log(np.diagonal(chol, axis1=-2, axis2=-1)).sum()
    Vinv = np.linalg.inv(V)
    A = Vinv.sum(axis=0)
    rhs = np.einsum("mij,mj->i", Vinv, y)
    b = np.linalg.solve(A, rhs)
    r = y - b
    quad = float(np.einsum("mi,mij,mj->", r, Vinv, r))
    sign, logdet_a = np.linalg.slogdet(A)
    if sign <= 0:
        return 1e12
    ll = -0.5 * (2 * m - 2) * math.log(2 * math.pi) - 0.5 * logdet_v - 0.5 * quad - 0.5 * logdet_a
    return -ll


def _fit_bivariate(y, S):
    """REML fit of the intercept-only bivariate model; returns (b, vcov, Psi)."""
    starts = [
        np.array([math.sqrt(0.1), 0.0, math.sqrt(0.1)]),
        np.array([math.sqrt(0.5), 0.0, math.sqrt(0.5)]),
    ]
    best = None
    for theta0 in starts:
        res = minimize(
            _reml_profile, theta0, args=(y, S), method="BFGS",
            options={"gtol": 1e-10, "maxiter": 500},
        )
        if best is None or res.fun < best.fun:
            best = res
    if not np.isfinite(best.fun) or best.fun >= 1e11:
        raise ValueError("reitsma_not_converged")
    theta = best.x
    L = np.array([[theta[0], 0.0], [theta[1], theta[2]]])
    psi = L @ L.T
    V = S + psi
    Vinv = np.linalg.inv(V)
    A = Vinv.sum(axis=0)
    vcov = np.linalg.inv(A)
    b = vcov @ np.einsum("mij,mj->i", Vinv, y)
    return b, vcov, psi


def reitsma(
    studies,
    *,
    compliance: dict,
    correction: float = 0.5,
    correction_control: str = "all",
    level: float = 0.95,
) -> dict:
    """Reitsma bivariate random-effects model (mada::reitsma defaults).

    Pools logit(sens) and logit(FPR); pooled specificity = 1 - pooled FPR.
    SROC curves on fpr = 0.01 .. 0.99: Rutter-Gatsonis (mada default) and
    naive. When a between-study SD is ~0 the Rutter-Gatsonis curve is
    undefined and its points are null.
    """
    require_ipd_approval(compliance)
    raw = _validate_studies(studies)
    if len(raw) < 2:
        raise ValueError("reitsma needs at least two studies")
    corrected, applied = _apply_correction(raw, correction, correction_control)
    y = np.zeros((len(corrected), 2))
    S = np.zeros((len(corrected), 2, 2))
    for i, s in enumerate(corrected):
        n_pos = s["TP"] + s["FN"]
        n_neg = s["FP"] + s["TN"]
        if n_pos <= 0 or n_neg <= 0:
            raise ValueError("zero_marginal")
        sens = s["TP"] / n_pos
        fpr = s["FP"] / n_neg
        if not (0 < sens < 1 and 0 < fpr < 1):
            raise ValueError("zero_cell")
        y[i] = (logit(sens), logit(fpr))
        S[i, 0, 0] = 1 / s["TP"] + 1 / s["FN"]
        S[i, 1, 1] = 1 / s["FP"] + 1 / s["TN"]
    b, vcov, psi = _fit_bivariate(y, S)
    z = z_value(level)
    se = np.sqrt(np.diag(vcov))
    coefs = []
    for j, term in enumerate(("tsens", "tfpr")):
        est = float(b[j])
        s = float(se[j])
        coefs.append(
            {
                "term": term,
                "estimate": est,
                "se": s,
                "z": est / s,
                "p": float(2 * norm.sf(abs(est / s))),
                "ciLower": est - z * s,
                "ciUpper": est + z * s,
            }
        )
    pooled_sens = float(expit(b[0]))
    pooled_fpr = float(expit(b[1]))
    fpr_grid = [i / 100 for i in range(1, 100)]
    tau1 = math.sqrt(max(psi[0, 0], 0.0))
    tau2 = math.sqrt(max(psi[1, 1], 0.0))
    rg = None
    if tau1 > 1e-8 and tau2 > 1e-8:
        lam = math.sqrt(tau2 / tau1) * b[0] - math.sqrt(tau1 / tau2) * b[1]
        beta = math.log(tau2 / tau1)
        rg = [
            float(expit(lam * math.exp(-beta / 2) + math.exp(-beta) * logit(f)))
            for f in fpr_grid
        ]
    naive = None
    if psi[1, 1] > 1e-12:
        theta = psi[0, 1] / psi[1, 1]
        naive = [float(expit(b[0] + theta * (logit(f) - b[1]))) for f in fpr_grid]
    spec = {
        "family": "diagnostic",
        "model": "reitsma",
        "correction": correction,
        "correctionControl": correction_control,
        "level": level,
    }
    return {
        "family": "diagnostic",
        "model": "reitsma",
        "correction": correction,
        "correctionControl": correction_control,
        "correctionApplied": applied,
        "level": level,
        "k": len(corrected),
        "coefficients": coefs,
        "psi": psi.tolist(),
        "pooledSens": pooled_sens,
        "pooledSensCiLower": float(expit(b[0] - z * se[0])),
        "pooledSensCiUpper": float(expit(b[0] + z * se[0])),
        "pooledFpr": pooled_fpr,
        "pooledSpec": 1 - pooled_fpr,
        "pooledSpecCiLower": float(1 - expit(b[1] + z * se[1])),
        "pooledSpecCiUpper": float(1 - expit(b[1] - z * se[1])),
        "sroc": {"fpr": fpr_grid, "ruttergatsonis": rg, "naive": naive},
        "manifest": model_manifest(spec, raw, len(corrected), __version__),
    }