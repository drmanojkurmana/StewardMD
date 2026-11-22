"""Inverse-variance meta-analysis with DerSimonian-Laird random effects.

Input effects and confidence limits are transformed to log scale for OR/RR/HR.
For MD/SMD the supplied effects are analysed on their original scale.
The service never invents study estimates; every row must come from a supplied,
auditable extraction. The default random-effects CI uses a normal critical value;
Hartung-Knapp and REML are intentionally not claimed in this first release.
"""
from __future__ import annotations

import math
from typing import Any

Z_95 = 1.959963984540054


class MetaAnalysisError(ValueError):
    pass


def _critical(confidence_level: float) -> float:
    # Accurate normal quantile for common confidence levels without scipy runtime dependency.
    # Acklam inverse-normal approximation.
    p = (1.0 + confidence_level) / 2.0
    if not 0.5 < p < 1.0:
        raise MetaAnalysisError("confidence_level must be between 0.5 and 1")
    a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
         1.383577518672690e2, -3.066479806614716e1, 2.506628277459239]
    b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
         6.680131188771972e1, -1.328068155288572e1]
    c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
         -2.549732539343734, 4.374664141464968, 2.938163982698783]
    d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
    plow = 0.02425
    phigh = 1 - plow
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > phigh:
        q = math.sqrt(-2 * math.log(1-p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5
    r = q*q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)


def calculate_meta_analysis(
    studies: list[dict[str, Any]],
    *,
    effect_measure: str,
    model: str = "random_dl",
    confidence_level: float = 0.95,
) -> dict[str, Any]:
    if len(studies) < 2:
        raise MetaAnalysisError("At least two studies are required")
    if effect_measure not in {"OR", "RR", "HR", "MD", "SMD"}:
        raise MetaAnalysisError("Unsupported effect measure")
    if model not in {"fixed", "random_dl"}:
        raise MetaAnalysisError("Unsupported pooling model")

    ratio = effect_measure in {"OR", "RR", "HR"}
    z = _critical(confidence_level)
    rows: list[dict[str, Any]] = []
    for s in studies:
        try:
            effect, lo, hi = float(s["effect"]), float(s["ci_lower"]), float(s["ci_upper"])
            if not (math.isfinite(effect) and math.isfinite(lo) and math.isfinite(hi) and lo < effect < hi):
                raise ValueError
            if ratio and min(effect, lo, hi) <= 0:
                raise ValueError
            transformed = [math.log(v) for v in (effect, lo, hi)] if ratio else [effect, lo, hi]
            yi = transformed[0]
            # Recover SE from a two-sided CI at the supplied confidence level.
            se = (transformed[2] - transformed[1]) / (2 * z)
            if not math.isfinite(se) or se <= 0:
                raise ValueError
        except (KeyError, TypeError, ValueError, OverflowError) as exc:
            raise MetaAnalysisError(f"Invalid effect or confidence interval for study {s.get('study_id', '?')}") from exc
        rows.append({"study_id": str(s["study_id"]), "label": str(s["label"]), "yi": yi, "vi": se * se,
                     "effect": effect, "ci_lower": lo, "ci_upper": hi, "se": se})

    w_fixed = [1 / r["vi"] for r in rows]
    sum_w = sum(w_fixed)
    fixed_y = sum(w * r["yi"] for w, r in zip(w_fixed, rows)) / sum_w
    q = sum(w * (r["yi"] - fixed_y) ** 2 for w, r in zip(w_fixed, rows))
    df = len(rows) - 1
    c = sum_w - sum(w*w for w in w_fixed) / sum_w
    tau2 = max(0.0, (q - df) / c) if c > 0 else 0.0
    weights = w_fixed if model == "fixed" else [1 / (r["vi"] + tau2) for r in rows]
    sw = sum(weights)
    pooled = sum(w * r["yi"] for w, r in zip(weights, rows)) / sw
    pooled_se = math.sqrt(1 / sw)
    pooled_lo, pooled_hi = pooled - z * pooled_se, pooled + z * pooled_se
    i2 = max(0.0, (q - df) / q) * 100 if q > 0 and df > 0 else 0.0

    def back(v: float) -> float:
        return math.exp(v) if ratio else v

    forest = []
    for r in rows:
        half = z * r["se"]
        forest.append({
            "studyId": r["study_id"], "label": r["label"], "effect": r["effect"],
            "ciLower": r["ci_lower"], "ciUpper": r["ci_upper"],
            "weightPercent": round((weights[len(forest)] / sw) * 100, 4),
        })

    return {
        "method": {"model": model, "estimator": "DerSimonian-Laird" if model == "random_dl" else "inverse-variance",
                   "confidenceLevel": confidence_level, "interval": "normal", "effectMeasure": effect_measure},
        "studiesIncluded": len(rows),
        "pooled": {"effect": back(pooled), "ciLower": back(pooled_lo), "ciUpper": back(pooled_hi),
                   "seOnAnalysisScale": pooled_se},
        "heterogeneity": {"q": q, "df": df, "iSquaredPercent": i2, "tauSquared": tau2},
        "forestPlot": {"scale": "log" if ratio else "linear", "rows": forest,
                       "pooled": {"effect": back(pooled), "ciLower": back(pooled_lo), "ciUpper": back(pooled_hi)}},
        "provenance": {"inputStudyIds": [r["study_id"] for r in rows],
                       "note": "Study-level estimates were supplied by the caller; no values were generated."},
    }
