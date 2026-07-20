"""Stage 12 — Evidence Fusion / Consensus Engine (deterministic, model-free).

Combines independent finding proposals (learned-model candidates and/or the deterministic Rule Engine)
into a single, calibrated consensus. This is NOT naive averaging: per-label confidences are fused in
LOG-ODDS space (a Bayesian-style consensus that rewards multiple independent agreeing sources), then the
result is MODULATED by clinically meaningful factors — signal quality, measurement consistency, source
agreement, explicit disagreement, and rule concordance — and finally clamped so the engine never asserts
absolute certainty. No trained model runs here; the fusion is closed-form arithmetic, so it stays
trustworthy even when every upstream model is a "not ready" stub. Pure Python + `math` (no numpy/cv2).

Expected input:
  candidates: list of {"source": str, "label": str, "confidence": float 0..1, "weight": float|None}
    — proposals from models and/or rules. Missing/None fields are tolerated (malformed items are skipped).
  validated:  the Rule Engine dict (see rules.BuiltinRules.validate) — {"matched","diagnoses","conflicts",...}.
  signal_quality, measurement_consistency: optional 0..1 reliability scores (None => neutral, no penalty).
Expected output:
  {"findings":[{"label","fusedConfidence","sources","agreement","ruleConcordance","factors","disagreement"}],
   "topLabel": str|None, "overallConfidence": float, "method": "logodds-consensus", "warnings": [str]}
Failure modes:
  Wrong container types raise BadImage (contract violation). Partial/None content never crashes: malformed
  candidates are skipped (with a warning), empty candidates fall back to the rule diagnoses, and no
  input at all yields empty findings with a warning.
Boundary:
  Fusion weights/thresholds are deterministic and documented but want calibration against a labelled,
  multi-source outcome set before the confidences are treated as anything more than decision support.
"""
from __future__ import annotations

import math
from typing import Any

from app.core.errors import BadImage

_STAGE = "fusion"
_METHOD = "logodds-consensus"

# Confidence is never allowed to be absolute — decision support, not diagnosis.
_CLAMP_LO = 0.02
_CLAMP_HI = 0.98
_EPS = 1e-6

# Modulation thresholds / gains (all deterministic).
_LOW_QUALITY = 0.5          # signal_quality below this raises a warning
_LOW_CONSISTENCY = 0.5      # measurement_consistency below this raises a warning
_LOW_AGREEMENT = 0.6        # top-finding agreement below this (with rivals) => "sources disagree" warning
_CONCORDANCE_BOOST = 0.5    # full rule concordance multiplies the log-odds deviation by (1 + this)
_COMPETING_PENALTY = 0.2    # deviation shrink when other sources propose different labels
_CONFLICT_PENALTY = 0.1     # extra deviation shrink when the rule engine reports contradictions
_DISAGREE_FLOOR = 0.5       # disagreement can shrink the deviation by at most one half

# Common ECG abbreviations -> canonical labels, so a model saying "AF" fuses with a rule "Atrial fibrillation".
_ALIASES: dict[str, str] = {
    "af": "atrial fibrillation", "afib": "atrial fibrillation", "a fib": "atrial fibrillation",
    "aflutter": "atrial flutter", "afl": "atrial flutter",
    "vt": "ventricular tachycardia", "svt": "supraventricular tachycardia",
    "vf": "ventricular fibrillation", "vfib": "ventricular fibrillation",
    "mi": "myocardial infarction", "ami": "acute myocardial infarction",
    "stemi": "st elevation myocardial infarction", "nstemi": "non st elevation myocardial infarction",
    "lbbb": "left bundle branch block", "rbbb": "right bundle branch block",
    "lvh": "left ventricular hypertrophy", "rvh": "right ventricular hypertrophy",
    "lad": "left axis deviation", "rad": "right axis deviation",
    "pac": "premature atrial contraction", "pvc": "premature ventricular contraction",
    "wpw": "ventricular pre-excitation", "sr": "sinus rhythm", "nsr": "normal sinus rhythm",
    "avb": "av block", "lqt": "prolonged qtc",
}

# Term families used for "related cluster" (partial) rule concordance.
_FAMILIES: tuple[str, ...] = (
    "fibrillation", "flutter", "tachycardia", "bradycardia", "block", "infarction",
    "ischemia", "ischaemia", "hypertrophy", "elevation", "depression", "excitation",
    "hyperkalemia", "qtc", "axis", "brugada",
)


def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def _finite(x: Any) -> float | None:
    """Coerce to a finite float, or None (NaN/inf/non-numeric are treated as missing)."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(v) or math.isinf(v)) else v


def _norm_label(label: Any) -> str:
    """Lowercase/trim/collapse whitespace, then map known abbreviations to a canonical label."""
    text = label if isinstance(label, str) else str(label)
    key = " ".join(text.strip().lower().split())
    return _ALIASES.get(key, key)


def _families(key: str) -> set[str]:
    return {fam for fam in _FAMILIES if fam in key}


def _logit(p: float) -> float:
    p = _clamp(p, _EPS, 1.0 - _EPS)
    return math.log(p / (1.0 - p))


def _sigmoid(x: float) -> float:
    """Numerically stable logistic (no OverflowError for extreme summed log-odds)."""
    if x >= 0.0:
        return 1.0 / (1.0 + math.exp(-x))
    z = math.exp(x)
    return z / (1.0 + z)


def _rule_index(validated: dict[str, Any]) -> dict[str, set[str]]:
    """Precompute normalized label sets from the rule engine for concordance lookup."""
    diagnoses = validated.get("diagnoses") or []
    matched = validated.get("matched") or []
    dx: set[str] = set()
    crit: set[str] = set()
    diff: set[str] = set()
    fam: set[str] = set()
    for d in diagnoses:
        if not isinstance(d, dict):
            continue
        lk = _norm_label(d.get("label", ""))
        if lk:
            dx.add(lk)
            fam |= _families(lk)
        for c in d.get("criteria") or []:
            if isinstance(c, dict):
                ck = _norm_label(c.get("description", ""))
                if ck:
                    crit.add(ck)
        for df in d.get("differentials") or []:
            if isinstance(df, dict):
                dfk = _norm_label(df.get("label", ""))
                if dfk:
                    diff.add(dfk)
                    fam |= _families(dfk)
    for m in matched:
        if isinstance(m, dict):
            mk = _norm_label(m.get("title", ""))
            if mk:
                crit.add(mk)
                fam |= _families(mk)
    return {"dx": dx, "crit": crit, "diff": diff, "fam": fam}


def _concordance(key: str, idx: dict[str, set[str]]) -> float:
    """1.0 = a validated diagnosis/criterion supports the label; 0.5 = related (differential or family); 0.0 = none."""
    if not key:
        return 0.0
    if key in idx["dx"] or key in idx["crit"]:
        return 1.0
    if any(key in d or d in key for d in idx["dx"]):   # tolerate qualifier suffixes, e.g. "... (paroxysmal)"
        return 1.0
    if key in idx["diff"]:
        return 0.5
    if _families(key) & idx["fam"]:
        return 0.5
    return 0.0


def _parse_candidates(candidates: list[Any]) -> tuple[list[dict[str, Any]], int]:
    """Validate + normalize candidates; return (clean list, count skipped). Never raises on bad items."""
    clean: list[dict[str, Any]] = []
    skipped = 0
    for i, c in enumerate(candidates):
        if not isinstance(c, dict):
            skipped += 1
            continue
        conf = _finite(c.get("confidence"))
        label = c.get("label")
        if conf is None or not isinstance(label, str) or not label.strip():
            skipped += 1
            continue
        weight = _finite(c.get("weight"))
        weight = 1.0 if weight is None else max(0.0, weight)
        raw_src = c.get("source")
        src = str(raw_src).strip() if isinstance(raw_src, (str, int, float)) and str(raw_src).strip() else f"source{i}"
        clean.append({"source": src, "label": label.strip(), "key": _norm_label(label),
                      "conf": _clamp(conf, 0.0, 1.0), "weight": weight})
    return clean, skipped


def _finding(label: str, fused: float, sources: list[str], agreement: float, concordance: float,
             model_conf: float, sq: float, mc: float, disagreement: list[str]) -> dict[str, Any]:
    return {
        "label": label,
        "fusedConfidence": round(fused, 3),
        "sources": sources,
        "agreement": round(agreement, 3),
        "ruleConcordance": round(concordance, 3),
        "factors": {
            "modelConfidence": round(model_conf, 3),
            "agreement": round(agreement, 3),
            "ruleConcordance": round(concordance, 3),
            "signalQuality": round(sq, 3),
            "measurementConsistency": round(mc, 3),
        },
        "disagreement": disagreement,
    }


def fuse(candidates: list[dict[str, Any]], validated: dict[str, Any],
         signal_quality: float | None = None,
         measurement_consistency: float | None = None) -> dict[str, Any]:
    """Fuse model/rule proposals into a calibrated consensus (log-odds + factor modulation).

    Algorithm (deterministic):
      1. Normalize labels (lowercase/trim + abbreviation aliases) and group candidates by label.
      2. agreement = (distinct sources for the label) / (distinct sources overall).
      3. ruleConcordance = 1.0 if a validated diagnosis/criterion supports the label, 0.5 if it is a
         related differential/family, else 0.0.
      4. Combine per-source confidences in LOG-ODDS space: p = sigmoid(Σ weight_i · logit(conf_i)) — this
         rewards multiple independent agreeing sources rather than blurring them like an average.
      5. Modulate the deviation from 0.5: shrink toward 0.5 as signal_quality / measurement_consistency /
         agreement drop or when rivals/conflicts exist; boost when ruleConcordance is high. Clamp to
         [0.02, 0.98] (never absolute certainty).
      6. overallConfidence = the top finding's fusedConfidence tempered by signal quality.
      7. With no candidates, derive findings from the validated diagnoses alone (rule confidence).

    Expected input / output / failure modes / boundary: see module docstring.
    """
    if candidates is None:
        candidates = []
    elif not isinstance(candidates, list):
        raise BadImage("candidates must be a list of proposals", stage=_STAGE)
    if validated is None:
        validated = {}
    elif not isinstance(validated, dict):
        raise BadImage("validated must be the rule-engine dict", stage=_STAGE)

    sq_raw = _finite(signal_quality)
    sq_provided = sq_raw is not None
    sq = _clamp(sq_raw, 0.0, 1.0) if sq_provided else 1.0
    mc_raw = _finite(measurement_consistency)
    mc_provided = mc_raw is not None
    mc = _clamp(mc_raw, 0.0, 1.0) if mc_provided else 1.0

    idx = _rule_index(validated)
    conflicts = [c for c in (validated.get("conflicts") or []) if isinstance(c, dict)]
    warnings: list[str] = []
    if sq_provided and sq < _LOW_QUALITY:
        warnings.append(f"low signal quality ({sq:.2f}); confidence gated toward 0.5")
    if mc_provided and mc < _LOW_CONSISTENCY:
        warnings.append(f"low measurement consistency ({mc:.2f}); confidence gated toward 0.5")
    for cf in conflicts:
        note = cf.get("note")
        if isinstance(note, str) and note:
            warnings.append(f"rule-engine conflict: {note}")

    clean, skipped = _parse_candidates(candidates)
    if skipped:
        warnings.append(f"ignored {skipped} malformed candidate(s)")

    # ── Fallback: no usable candidates -> surface the rule-engine diagnoses directly ──────────────
    if not clean:
        findings: list[dict[str, Any]] = []
        diagnoses = [d for d in (validated.get("diagnoses") or []) if isinstance(d, dict)]
        dis = [f"conflict: {cf.get('note')}" for cf in conflicts if isinstance(cf.get("note"), str)]
        for d in diagnoses:
            conf = _finite(d.get("confidence"))
            conf = _clamp(conf if conf is not None else 0.0, 0.0, 1.0)
            fused = _clamp(0.5 + (conf - 0.5) * sq, _CLAMP_LO, _CLAMP_HI)   # quality gate still applies
            label = str(d.get("label") or "").strip() or "unlabelled finding"
            findings.append(_finding(label, fused, ["rule-engine"], 1.0, 1.0, conf, sq, mc, list(dis)))
        findings.sort(key=lambda f: (-f["fusedConfidence"], f["label"]))
        if findings:
            warnings.append("no model candidates; findings derived from the rule engine alone")
            top_fused = findings[0]["fusedConfidence"]
            overall = _clamp(top_fused * (0.5 + 0.5 * sq), _CLAMP_LO, _CLAMP_HI)
            top_label: str | None = findings[0]["label"]
        else:
            warnings.append("no candidates and no rule diagnoses; nothing to fuse")
            overall = 0.0
            top_label = None
        return {"findings": findings, "topLabel": top_label, "overallConfidence": round(overall, 3),
                "method": _METHOD, "warnings": warnings}

    # ── Consensus path: group by normalized label ────────────────────────────────────────────────
    total_sources = len({c["source"] for c in clean})
    groups: dict[str, dict[str, Any]] = {}
    for c in clean:
        g = groups.setdefault(c["key"], {"display": c["label"], "src": {}})
        prev = g["src"].get(c["source"])
        if prev is None or c["conf"] > prev["conf"]:      # one vote per source (its most confident)
            g["src"][c["source"]] = {"conf": c["conf"], "weight": c["weight"]}

    has_rivals = len([k for k, g in groups.items() if g["src"]]) > 1
    findings = []
    for key, g in groups.items():
        srcs = sorted(g["src"].keys())
        agreement = (len(srcs) / total_sources) if total_sources else 0.0
        log_odds = sum(s["weight"] * _logit(s["conf"]) for s in g["src"].values())
        combined = _sigmoid(log_odds)
        concordance = _concordance(key, idx)

        boost = 1.0 + _CONCORDANCE_BOOST * concordance
        disagree = 1.0 - (_COMPETING_PENALTY if has_rivals else 0.0) - (_CONFLICT_PENALTY if conflicts else 0.0)
        disagree = max(_DISAGREE_FLOOR, disagree)
        sharpness = sq * (0.5 + 0.5 * mc) * (0.5 + 0.5 * agreement) * boost * disagree
        fused = _clamp(0.5 + (combined - 0.5) * sharpness, _CLAMP_LO, _CLAMP_HI)

        dis = [f"{other['display']} (sources: {sorted(other['src'].keys())})"
               for k, other in groups.items() if k != key and other["src"]]
        dis += [f"conflict: {cf.get('note')}" for cf in conflicts if isinstance(cf.get("note"), str)]

        findings.append(_finding(g["display"], fused, srcs, agreement, concordance, combined, sq, mc, dis))

    findings.sort(key=lambda f: (-f["fusedConfidence"], -f["ruleConcordance"], -f["agreement"], f["label"]))

    top = findings[0]
    if total_sources <= 1:
        warnings.append("only one source contributed; consensus not established")
    elif has_rivals and top["agreement"] < _LOW_AGREEMENT:
        warnings.append("sources disagree on the primary finding; consensus is weak")

    overall = _clamp(top["fusedConfidence"] * (0.5 + 0.5 * sq), _CLAMP_LO, _CLAMP_HI)
    return {"findings": findings, "topLabel": top["label"], "overallConfidence": round(overall, 3),
            "method": _METHOD, "warnings": warnings}
