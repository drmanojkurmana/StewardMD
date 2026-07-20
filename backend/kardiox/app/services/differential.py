"""Clinical Differential Diagnosis Engine (deterministic; never fabricates).

KardioX must not be binary (one answer OR "I don't know"). This engine turns the multi-source evidence
(rule engine + fused model candidates + measurements + quality) into RANKED differentials, each with
supporting AND conflicting evidence and a plain-language "why", plus graceful uncertainty handling and a
nearest-electrophysiological-pattern fallback for conditions no model/rule covered.

It ORCHESTRATES existing engines — it invents nothing: every confidence comes from the fusion/rule output
and every evidence string is drawn from real matched criteria, measurements, quality flags, or model
agreement. `source_weight` supplies validation/calibration/specialization weighting for the fusion step
(weights reflect DECLARED validation metrics — defaults until a model is validated; never fabricated).

Expected input:  validated (rule engine), consensus (fusion result), measurements, st, quality_report,
                 signal_quality, morphology, explanations (optional).
Expected output: a DifferentialReport dict (primary + top-N differentials + uncertainty + recommendations
                 + overlays + cardiologistReviewRecommended + nextStep + disclaimer).
"""
from __future__ import annotations

DISCLAIMER = "AI decision support - not a diagnosis. Confirm clinically."
_UNCERTAIN_BELOW = 0.6        # primary confidence below this => uncertain
_LOW_QUALITY_BELOW = 0.5      # signal-quality below this => quality caution

# Source reliability priors — weight a source's vote in fusion by validation performance + calibration +
# specialization. These are HONEST DEFAULTS (no model validated in-repo yet); update from ModelRegistry
# metrics once a model is validated. Rules + measurement (deterministic, validated) are trusted most.
_SOURCE_RELIABILITY = {
    "rules": 1.0,
    "signal-rhythm": 0.7,
    "measurement": 0.9,
    "ecglib": 0.6,            # real pretrained classifiers; raise once validated on our label set
    "torchecg": 0.5,
    "ecg-fm": 0.4,            # foundation encoders need a fine-tuned head → lower until validated
    "deepecg-ssl": 0.4,
    "heartgpt": 0.4,
}
_DEFAULT_WEIGHT = 0.4


def source_weight(source: str) -> float:
    """Fusion weight for a source from its (declared) validation/calibration/specialization reliability."""
    return float(_SOURCE_RELIABILITY.get((source or "").lower(), _DEFAULT_WEIGHT))


def _norm(s) -> str:
    return str(s or "").strip().lower()


def _match_diagnosis(label: str, diagnoses: list[dict]) -> dict | None:
    n = _norm(label)
    for d in diagnoses or []:
        dl = _norm(d.get("label"))
        if dl and (dl == n or dl in n or n in dl):
            return d
    return None


def _measurement_evidence(meas: dict) -> list[str]:
    out = []
    m = meas or {}
    if m.get("heartRate") is not None:
        out.append(f"Ventricular rate {round(float(m['heartRate']))} bpm")
    for key, lab, unit in (("prMs", "PR", "ms"), ("qrsMs", "QRS", "ms"), ("qtcMs", "QTc", "ms"),
                           ("axisDeg", "Axis", "deg")):
        if m.get(key) is not None:
            out.append(f"{lab} {round(float(m[key]))} {unit}")
    return out


def _conflicting_evidence(finding: dict, validated: dict, quality_report: dict | None,
                          signal_quality, meas: dict) -> list[str]:
    out = []
    # quality / noise
    if signal_quality is not None and float(signal_quality) < _LOW_QUALITY_BELOW:
        out.append(f"Reduced signal quality ({round(float(signal_quality), 2)})")
    q = quality_report or {}
    if q.get("gate") == "warn":
        for r in (q.get("reasons") or [])[:2]:
            out.append(f"Image quality: {r}")
    # model disagreement on this finding
    dis = finding.get("disagreement") or []
    if dis:
        out.append("Model disagreement: " + ", ".join(map(str, dis[:3])))
    if finding.get("agreement") is not None and float(finding.get("agreement", 1)) < 0.5 and finding.get("sources"):
        out.append("Only a minority of sources concur")
    # rule engine conflicts
    for c in (validated or {}).get("conflicts", []) or []:
        note = c.get("note") if isinstance(c, dict) else str(c)
        if note:
            out.append(note)
    # borderline measurements
    qtc = (meas or {}).get("qtcMs")
    if isinstance(qtc, (int, float)) and 440 < qtc <= 480:
        out.append(f"Borderline QTc ({round(float(qtc))} ms)")
    return out


def _supporting_evidence(finding: dict, dx: dict | None, meas: dict) -> list[str]:
    out = []
    if dx:
        for c in dx.get("criteria", []) or []:
            desc = c.get("description") or c.get("id")
            val = c.get("measuredValue")
            if desc:
                out.append(f"{desc}: {val}" if val else str(desc))
    out.extend(_measurement_evidence(meas))
    srcs = finding.get("sources") or []
    if len(srcs) > 1:
        out.append("Model agreement: " + ", ".join(map(str, srcs)))
    # de-duplicate, keep order
    seen, uniq = set(), []
    for e in out:
        if e not in seen:
            seen.add(e)
            uniq.append(e)
    return uniq


def _nearest_pattern(meas: dict, rhythm: dict, morphology: dict) -> list[dict]:
    """Deterministic nearest-electrophysiological-pattern differential from MEASURED features only, when
    no model/rule finding exists. Clearly a differential, not a definitive diagnosis. Never fabricates."""
    m, r, mo = meas or {}, rhythm or {}, morphology or {}
    rate = r.get("rateBpm") if r.get("rateBpm") is not None else m.get("heartRate")
    regular = _norm(r.get("regularity")) != "irregular"
    qrs = m.get("qrsMs")
    wide = isinstance(qrs, (int, float)) and qrs >= 120
    p_present = _norm(mo.get("pWaves")) == "present"
    if rate is None:
        return []
    band = "tachycardia" if rate > 100 else "bradycardia" if rate < 60 else "normal-rate"
    complex_w = "wide-complex" if wide else "narrow-complex"
    reg = "regular" if regular else "irregular"
    supporting = [f"Rate {round(float(rate))} bpm ({band})", f"{reg} {complex_w} rhythm"]
    if isinstance(qrs, (int, float)):
        supporting.append(f"QRS {round(float(qrs))} ms")
    if mo.get("pWaves"):
        supporting.append(f"P waves {mo['pWaves']}")

    # nearest named differentials by pattern (each a modest, pattern-based confidence)
    if wide and regular and rate > 100:
        names = ["Ventricular tachycardia", "SVT with aberrancy", "Antidromic AVRT"]
    elif wide and regular:
        names = ["Sinus rhythm with bundle branch block", "Ventricular/paced rhythm"]
    elif not wide and regular and rate > 100:
        names = ["Sinus tachycardia", "SVT (AVNRT/AVRT)", "Atrial flutter"] if not p_present else \
                ["Sinus tachycardia", "Atrial tachycardia"]
    elif not wide and not regular:
        names = ["Atrial fibrillation", "Multifocal atrial tachycardia", "Sinus arrhythmia with ectopy"]
    elif not wide and regular and rate < 60:
        names = ["Sinus bradycardia", "Junctional rhythm", "AV block"]
    else:
        names = ["Sinus rhythm", "Sinus arrhythmia"]

    base = 0.42
    out = []
    for i, name in enumerate(names[:3]):
        out.append({"label": name, "confidence": round(base - i * 0.12, 2),
                    "supporting": supporting, "conflicting": ["Pattern-based only; no model/rule confirmation"],
                    "sources": ["pattern-match"], "severity": "info",
                    "why": f"Nearest electrophysiological pattern for a {reg} {complex_w} rhythm at "
                           f"{round(float(rate))} bpm; differential, not definitive."})
    return out


def _uncertainty(primary_conf: float, quality_report: dict | None, signal_quality,
                 top_finding: dict, nearest: bool, meas: dict, st: dict) -> dict:
    reasons, recs = [], []
    poor_quality = (signal_quality is not None and float(signal_quality) < _LOW_QUALITY_BELOW) or \
                   ((quality_report or {}).get("gate") == "warn")
    disagreement = bool(top_finding.get("disagreement")) if top_finding else False
    if poor_quality:
        reasons.append("Reduced image/signal quality")
        recs.append("Repeat the ECG with better electrode contact and minimal motion")
    if disagreement:
        reasons.append("Models disagree on the leading interpretation")
    if primary_conf < _UNCERTAIN_BELOW:
        reasons.append(f"Leading interpretation confidence is modest ({round(primary_conf * 100)}%)")
    if nearest:
        reasons.append("No model/rule finding matched; interpretation is pattern-based")
    # additional-leads suggestion when territory hints at posterior/right-sided involvement
    terr = _norm((st or {}).get("territory"))
    if terr in ("inferior", "anterior"):
        recs.append("Consider additional leads (posterior V7-V9 / right-sided V3R-V4R) to localize")
    if reasons:
        recs.append("Correlate clinically (symptoms, prior ECGs, troponin where indicated)")
        recs.append("Consider a repeat or serial ECG if clinical suspicion persists")
    level = "high" if (primary_conf < 0.4 or nearest) else "moderate" if reasons else "low"
    return {"isUncertain": bool(reasons), "level": level, "reasons": reasons,
            "recommendations": _dedupe(recs)}


def _dedupe(xs: list[str]) -> list[str]:
    seen, out = set(), []
    for x in xs:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def build_differential(validated: dict, consensus: dict | None, measurements: dict, st: dict,
                       quality_report: dict | None = None, signal_quality=None,
                       morphology: dict | None = None, rhythm: dict | None = None,
                       explanations: list[dict] | None = None, top_n: int = 3) -> dict:
    validated = validated or {}
    diagnoses = validated.get("diagnoses", []) or []
    findings = list((consensus or {}).get("findings") or [])

    # candidate set: prefer fused findings; else the rule diagnoses; else nearest-pattern fallback.
    nearest = False
    ranked: list[dict] = []
    if findings:
        for f in findings:
            dx = _match_diagnosis(f.get("label"), diagnoses)
            conf = float(f.get("fusedConfidence", f.get("confidence", 0.0)))
            ranked.append({
                "label": f.get("label"), "confidence": round(conf, 2),
                "severity": (dx or {}).get("severity", "info"),
                "supporting": _supporting_evidence(f, dx, measurements),
                "conflicting": _conflicting_evidence(f, validated, quality_report, signal_quality, measurements),
                "sources": f.get("sources") or [],
                "why": (dx or {}).get("whatToVerify") or "Fused from the available evidence.",
            })
    elif diagnoses:
        for d in diagnoses:
            ranked.append({
                "label": d.get("label"), "confidence": round(float(d.get("confidence", 0.0)), 2),
                "severity": d.get("severity", "info"),
                "supporting": _supporting_evidence({"sources": []}, d, measurements),
                "conflicting": _conflicting_evidence({}, validated, quality_report, signal_quality, measurements),
                "sources": ["rules"], "why": d.get("whatToVerify") or "Rule-engine validated.",
            })
    else:
        nearest = True
        ranked = _nearest_pattern(measurements, rhythm or {}, morphology or {})

    ranked.sort(key=lambda x: -x.get("confidence", 0.0))
    for i, r in enumerate(ranked, 1):
        r["rank"] = i

    primary = ranked[0] if ranked else None
    primary_conf = float(primary["confidence"]) if primary else 0.0
    top_finding = findings[0] if findings else {}
    uncertainty = _uncertainty(primary_conf, quality_report, signal_quality, top_finding, nearest,
                               measurements, st or {})

    critical = bool(primary and primary.get("severity") == "critical")
    review = bool(critical or uncertainty["isUncertain"] or nearest
                  or (signal_quality is not None and float(signal_quality) < _LOW_QUALITY_BELOW))

    if critical:
        next_step = "URGENT clinician review; " + (primary.get("why") or "correlate clinically")
    elif review:
        next_step = "Clinician review recommended; correlate clinically" + \
                    (" and consider repeat ECG" if uncertainty["isUncertain"] else "")
    else:
        next_step = "Routine review; correlate clinically"

    overlays = []
    for e in (explanations or []):
        overlays.extend(e.get("regionHighlights") or [])

    return {
        "primary": primary,
        "differentials": ranked[:max(1, top_n)],
        "uncertainty": uncertainty,
        "overlays": overlays,
        "cardiologistReviewRecommended": review,
        "nextStep": next_step,
        "patternBased": nearest,
        "disclaimer": DISCLAIMER,
    }
