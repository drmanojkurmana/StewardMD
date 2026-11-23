"""Phase 5D.2 survival models, canonical for ResearchMD.

Kaplan-Meier with Greenwood confidence intervals and median survival,
the log-rank test, and Cox proportional hazards with Efron ties plus a
Schoenfeld-residual PH test. Reference calls pinned for R parity
(scripts/research-parity-5d.R) on survival::lung (event = status == 2):

- survfit(Surv(time, event) ~ 1): steps at EVERY unique observation time
  (censoring-only times carry nEvent 0 and a flat curve). std.err is the
  Greenwood SE of log S, sqrt(sum d / (n (n - d))); the default conf.type
  "log" gives S * exp(+/- z * se), upper capped at 1. When n == d the
  Greenwood term is undefined: se and CI are null. Median and its CI follow
  survival's minmin rule (first time the curve, lower band or upper band
  reaches 0.5, with the flat-spot midpoint rule, tolerance sqrt(eps)).
- survdiff(Surv(time, event) ~ group, rho = 0): Mantel-Haenszel log-rank.
- coxph(Surv(time, event) ~ x, ties = "efron"): Newton-Raphson on the Efron
  partial likelihood; normal-based inference on the inverse information.
- cox.zph(fit, transform = "km"): the exact score test for a time-varying
  coefficient beta(t) = beta + theta g(t), g(t) = 1 - KM(t-). At each event
  time the Efron information block A_t and Schoenfeld residual sum r_t are
  weighted by g(t) and g(t)^2 (g evaluated at the event time, constant over
  the risk set): U = sum g_t r_t, Ibb = sum A_t, Ibt = sum g_t A_t,
  Itt = sum g_t^2 A_t, Schur S = Itt - Ibt' Ibb^-1 Ibt; per-term
  chisq = U_j^2 / S_jj (1 df), global chisq = U' S^-1 U (p df). This matches
  cox.zph exactly (verified against survival 3.8-12); the closed-form
  Grambsch-Therneau approximation does NOT.

IPD rule (5C.3): every function refuses to run without the compliance flag
{"ipdApproved": True, "evidenceId": ...}. There is no LLM call in this
package; patient-level rows never reach an LLM and never leave the worker
process. Only aggregate statistics and a data hash are returned.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.stats import chi2, norm

from ._common import (
    __version__,
    as_float_array,
    finite_or_none,
    model_manifest,
    require_ipd_approval,
    z_value,
)

_TOL = math.sqrt(np.finfo(float).eps)  # survival's minmin tolerance


def _check_surv_input(time, event):
    t = as_float_array(time, "time")
    e = as_float_array(event, "event")
    if len(t) != len(e) or len(t) == 0:
        raise ValueError("time and event must be non-empty arrays of equal length")
    if np.any(t < 0):
        raise ValueError("time must be non-negative")
    if not np.all((e == 0) | (e == 1)):
        raise ValueError("event must be 0/1")
    if e.sum() == 0:
        raise ValueError("no_events")
    return t, e


def _km_curve(t: np.ndarray, e: np.ndarray):
    """Event times and KM survival just after each event time (no CI)."""
    order = np.argsort(t, kind="stable")
    ts, es = t[order], e[order]
    times, surv = [], []
    s = 1.0
    n = len(ts)
    i = 0
    while i < n:
        j = i
        while j < n and ts[j] == ts[i]:
            j += 1
        d = int(es[i:j].sum())
        if d > 0:
            n_risk = n - i
            s *= 1 - d / n_risk
            times.append(float(ts[i]))
            surv.append(s)
        i = j
    return np.asarray(times), np.asarray(surv)


def _minmin(y, x):
    """survival's minmin: first x where y < 0.5 + tol, flat-spot midpoint rule."""
    keep = [i for i in range(len(y)) if y[i] is not None and y[i] < 0.5 + _TOL]
    if not keep:
        return None
    first = keep[0]
    y1 = y[first]
    if abs(y1 - 0.5) < _TOL:
        for i in keep[1:]:
            if y[i] < y1:
                return (x[first] + x[i]) / 2
    return x[first]


def kaplan_meier(time, event, *, compliance: dict, level: float = 0.95) -> dict:
    """KM curve with Greenwood log-scale CI, median survival and its CI.

    Steps are emitted at every unique observation time, matching survfit.
    se is the Greenwood SE of log S. CI is the survfit default 'log' type:
    S * exp(+/- z * se), upper capped at 1; null when undefined (n == d or
    S == 0). Median CI is minmin applied to the lower and upper bands.
    """
    require_ipd_approval(compliance)
    t, e = _check_surv_input(time, event)
    z = z_value(level)
    order = np.argsort(t, kind="stable")
    ts, es = t[order], e[order]
    n = len(ts)
    steps = []
    s = 1.0
    logvar = 0.0
    i = 0
    while i < n:
        j = i
        while j < n and ts[j] == ts[i]:
            j += 1
        n_risk = n - i
        d = int(es[i:j].sum())
        c = (j - i) - d
        if d > 0:
            s *= 1 - d / n_risk
            if n_risk > d:
                logvar += d / (n_risk * (n_risk - d))
            else:
                logvar = math.inf
        se = math.sqrt(logvar) if math.isfinite(logvar) else None
        if se is None or s == 0:
            lo = hi = None
        elif se == 0:
            lo = hi = s
        else:
            lo = s * math.exp(-z * se)
            hi = min(s * math.exp(z * se), 1.0)
        steps.append(
            {
                "time": float(ts[i]),
                "nRisk": n_risk,
                "nEvent": d,
                "nCensor": c,
                "surv": s,
                "se": finite_or_none(se) if se is not None else None,
                "ciLower": lo,
                "ciUpper": hi,
            }
        )
        i = j
    times = [st["time"] for st in steps]
    median = _minmin([st["surv"] for st in steps], times)
    median_lo = _minmin([st["ciLower"] for st in steps], times)
    median_hi = _minmin([st["ciUpper"] for st in steps], times)
    spec = {"family": "km", "level": level}
    data = {"time": t.tolist(), "event": e.tolist()}
    return {
        "family": "km",
        "level": level,
        "steps": steps,
        "median": median,
        "medianCiLower": median_lo,
        "medianCiUpper": median_hi,
        "n": n,
        "events": int(e.sum()),
        "manifest": model_manifest(spec, data, n, __version__),
    }


def log_rank(time, event, group, *, compliance: dict) -> dict:
    """Mantel-Haenszel log-rank test (survdiff rho = 0), two or more groups."""
    require_ipd_approval(compliance)
    t, e = _check_surv_input(time, event)
    g = np.asarray(group)
    if g.ndim != 1 or len(g) != len(t):
        raise ValueError("group must be an array of the same length")
    labels = sorted(set(g.tolist()))
    if len(labels) < 2:
        raise ValueError("log_rank needs at least two groups")
    gi = np.asarray([labels.index(v) for v in g.tolist()])
    G = len(labels)
    observed = np.zeros(G)
    expected = np.zeros(G)
    var = np.zeros((G, G))
    order = np.argsort(t, kind="stable")
    ts, es, gs = t[order], e[order], gi[order]
    n = len(ts)
    i = 0
    while i < n:
        j = i
        while j < n and ts[j] == ts[i]:
            j += 1
        d = int(es[i:j].sum())
        if d > 0:
            n_risk = n - i
            nr = np.bincount(gs[i:], minlength=G).astype(float)
            dd = np.bincount(gs[i:j][es[i:j] == 1], minlength=G).astype(float)
            observed += dd
            expected += d * nr / n_risk
            if n_risk > 1:
                f = d * (n_risk - d) / (n_risk - 1)
                p = nr / n_risk
                var += f * (np.diag(p) - np.outer(p, p))
        i = j
    u = (observed - expected)[: G - 1]
    v = var[: G - 1, : G - 1]
    chisq = float(u @ np.linalg.solve(v, u))
    df = G - 1
    groups = [
        {
            "group": labels[k],
            "n": int((gi == k).sum()),
            "observed": float(observed[k]),
            "expected": float(expected[k]),
        }
        for k in range(G)
    ]
    spec = {"family": "logrank"}
    data = {"time": t.tolist(), "event": e.tolist(), "group": g.tolist()}
    return {
        "family": "logrank",
        "chisq": chisq,
        "df": df,
        "p": float(chi2.sf(chisq, df)),
        "groups": groups,
        "manifest": model_manifest(spec, data, n, __version__),
    }


def _efron_terms(beta, ts, es, X, blocks, shift=0.0):
    """Efron partial log-likelihood, score and information at beta.

    blocks: list of (start_index, death_indices) per unique event time,
    rows sorted by time. shift stabilises exp(); ratios are shift-invariant.
    """
    n, p = X.shape
    eta = X @ beta - shift
    w = np.exp(eta)
    ll = 0.0
    score = np.zeros(p)
    info = np.zeros((p, p))
    for start, deaths in blocks:
        d = len(deaths)
        Xr, wr = X[start:], w[start:]
        S0 = wr.sum()
        S1 = wr @ Xr
        S2 = (Xr * wr[:, None]).T @ Xr
        Xd, wd = X[deaths], w[deaths]
        S0d = wd.sum()
        S1d = wd @ Xd
        S2d = (Xd * wd[:, None]).T @ Xd
        ll += eta[deaths].sum()
        score += Xd.sum(axis=0)
        for l in range(d):
            f = l / d
            s0 = S0 - f * S0d
            s1 = S1 - f * S1d
            s2 = S2 - f * S2d
            xb = s1 / s0
            ll -= math.log(s0)
            score -= xb
            info += s2 / s0 - np.outer(xb, xb)
    return ll, score, info


def _event_blocks(ts, es):
    blocks = []
    n = len(ts)
    i = 0
    while i < n:
        j = i
        while j < n and ts[j] == ts[i]:
            j += 1
        deaths = np.arange(i, j)[es[i:j] == 1]
        if len(deaths) > 0:
            blocks.append((i, deaths))
        i = j
    return blocks


def cox_ph(
    time,
    event,
    covariates: dict,
    *,
    compliance: dict,
    level: float = 0.95,
) -> dict:
    """Cox PH, Efron ties, Newton-Raphson; HR with normal-based CI and p.

    covariates is a column-oriented dict (no intercept). The result carries
    the Schoenfeld-residual PH test (cox.zph transform='km' equivalent).
    """
    require_ipd_approval(compliance)
    t, e = _check_surv_input(time, event)
    if not isinstance(covariates, dict) or not covariates:
        raise ValueError("covariates must be a non-empty object of named arrays")
    names = list(covariates)
    cols = [as_float_array(covariates[name], name) for name in names]
    n = len(t)
    if any(len(c) != n for c in cols):
        raise ValueError("covariate length mismatch")
    p = len(names)
    if n <= p:
        raise ValueError("too_few_rows")
    X = np.column_stack(cols)
    order = np.argsort(t, kind="stable")
    ts, es, Xs = t[order], e[order], X[order]
    blocks = _event_blocks(ts, es)

    beta = np.zeros(p)
    ll, score, info = _efron_terms(beta, ts, es, Xs, blocks)
    for _ in range(100):
        step = np.linalg.solve(info, score)
        if np.max(np.abs(step)) < 1e-10:
            break
        new_ll, new_score, new_info = _efron_terms(beta + step, ts, es, Xs, blocks)
        halt = 0
        while new_ll < ll and halt < 25:
            step *= 0.5
            new_ll, new_score, new_info = _efron_terms(beta + step, ts, es, Xs, blocks)
            halt += 1
        if new_ll < ll:
            break  # no ascent left at floating-point precision; score check below guards it
        rel = abs(1.0 - ll / new_ll) if new_ll != 0 else abs(new_ll - ll)
        beta = beta + step
        ll, score, info = new_ll, new_score, new_info
        if rel < 1e-14:
            break  # R coxph-style log-likelihood convergence; BLAS noise can keep the step above 1e-10
    else:
        raise ValueError("cox_not_converged")
    # scale-free check: the remaining Newton step, not the raw score (score grows with covariate scale, e.g. age)
    if np.max(np.abs(np.linalg.solve(info, score))) > 1e-6:
        raise ValueError("cox_not_converged")

    if not np.all(np.isfinite(beta)) or np.max(np.abs(beta)) > 1e6:
        raise ValueError("cox_not_converged")  # e.g. complete separation
    vcov = np.linalg.inv(info)
    se = np.sqrt(np.diag(vcov))
    if not np.all(np.isfinite(se)) or np.max(se) > 1e6:
        raise ValueError("cox_not_converged")
    z = z_value(level)
    coefs = []
    for j, name in enumerate(names):
        b = float(beta[j])
        s = float(se[j])
        zstat = b / s
        coefs.append(
            {
                "term": name,
                "coef": b,
                "se": s,
                "z": zstat,
                "p": float(2 * norm.sf(abs(zstat))),
                "hr": math.exp(b),
                "hrCiLower": math.exp(b - z * s),
                "hrCiUpper": math.exp(b + z * s),
            }
        )
    loglik, _, _ = _efron_terms(beta, ts, es, Xs, blocks, shift=0.0)
    ph = _schoenfeld_ph_test(t, e, X, beta, ts, es, Xs, blocks, names)
    spec = {"family": "cox", "ties": "efron", "covariates": names, "level": level}
    data = {"time": t.tolist(), "event": e.tolist()}
    data.update({name: covariates[name] if isinstance(covariates[name], list) else list(covariates[name]) for name in names})
    return {
        "family": "cox",
        "ties": "efron",
        "covariates": names,
        "level": level,
        "coefficients": coefs,
        "n": n,
        "events": int(e.sum()),
        "logLik": float(loglik),
        "phTest": ph,
        "manifest": model_manifest(spec, data, n, __version__),
    }


def _schoenfeld_ph_test(t, e, X, beta, ts, es, Xs, blocks, names) -> dict:
    """Exact cox.zph(transform='km') score test (see module docstring)."""
    event_times, surv = _km_curve(t, e)
    prefix = np.concatenate(([1.0], surv))
    # g depends only on time; compute on the sorted arrays so the event-block
    # indices (which index the sorted rows) line up.
    idx = np.searchsorted(event_times, ts, side="left")
    g = 1.0 - prefix[idx]
    gc = g - g[es == 1].mean()
    p = X.shape[1]
    U = np.zeros(p)
    Ibb = np.zeros((p, p))
    Ibt = np.zeros((p, p))
    Itt = np.zeros((p, p))
    eta = Xs @ beta
    w = np.exp(eta - eta.max())
    for start, deaths in blocks:
        d = len(deaths)
        Xr, wr = Xs[start:], w[start:]
        S0 = wr.sum()
        S1 = wr @ Xr
        S2 = (Xr * wr[:, None]).T @ Xr
        Xd, wd = Xs[deaths], w[deaths]
        S0d = wd.sum()
        S1d = wd @ Xd
        S2d = (Xd * wd[:, None]).T @ Xd
        A = np.zeros((p, p))
        xb_sum = np.zeros(p)
        for l in range(d):
            f = l / d
            s0 = S0 - f * S0d
            xb = (S1 - f * S1d) / s0
            A += (S2 - f * S2d) / s0 - np.outer(xb, xb)
            xb_sum += xb
        r_t = Xd.sum(axis=0) - xb_sum  # sum of Efron Schoenfeld residuals at t
        gt = gc[deaths[0]]
        U += gt * r_t
        Ibb += A
        Ibt += gt * A
        Itt += gt * gt * A
    schur = Itt - Ibt.T @ np.linalg.solve(Ibb, Ibt)
    terms = []
    for j, name in enumerate(names):
        chisq = float(U[j] ** 2 / schur[j, j])
        terms.append({"term": name, "chisq": chisq, "df": 1, "p": float(chi2.sf(chisq, 1))})
    global_chisq = float(U @ np.linalg.solve(schur, U))
    return {
        "transform": "km",
        "terms": terms,
        "global": {"chisq": global_chisq, "df": p, "p": float(chi2.sf(global_chisq, p))},
    }