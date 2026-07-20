"""Explainability engine (Phase 7) — pure-python, HONEST: assembles evidence, invents NOTHING.

A validated diagnosis (services/rules.py) already carries the WHY as structured data: matched criteria,
per-lead evidence, differentials, and a what-to-verify note. This module reshapes that (plus the shared
pipeline context) into the compact, UI-ready explanation the report/waveform screens draw. It NEVER adds
a lead, window, measurement, or claim that is not present in the finding or the context — where a piece
of evidence is absent it is simply omitted, so the explanation can only ever under-claim, never over-claim.

There is no learning and no model here: `explain_finding` is a deterministic projection of its inputs.
The two model-derived inputs it consumes (model agreement/disagreement via `ctx["fusion"]`, and
delineation fiducials via `ctx["delineation"]`) are produced upstream; this module only reads them and
degrades gracefully to safe defaults when they are absent.

Expected input:  `finding` — a validated diagnosis dict (id,label,severity,confidence,criteria,
                 differentials,evidence,whatToVerify); `ctx` — the shared pipeline context
                 {measurements, st, rhythm, validated, fusion|None, delineation|None, fs|None}.
Expected output: {why, leads, abnormalWindows, measurements, rulesPassed, modelsAgreed, modelsDisagreed,
                 regionHighlights, confidence} — see `explain_finding`.
Failure modes:   `finding` not a dict -> KardioXError(code="bad_input"); missing/partial ctx pieces ->
                 the corresponding output fields fall back to empty lists (never crashes); NaN / non-finite
                 sample indices are dropped.
Boundary:        assembly only — it derives no new diagnosis and computes no new measurement; the truth of
                 the criteria and windows is the responsibility of the rule engine / delineation upstream.
"""
from __future__ import annotations

from app.core.errors import KardioXError

_STAGE = "clinicalExplanation"

# Canonical 12-lead order; `leads` is returned in this order (unknown leads appended, original order kept).
STANDARD_12 = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]

_WINDOW_HALF_S = 0.06          # half-width (s) of a beat-centred highlight window (~120 ms total QRS band)
_DEFAULT_HALF_SAMPLES = 30     # fallback half-width in samples when the sampling rate is unknown
_MAX_WINDOWS_PER_LEAD = 24     # cap per lead so pathological fiducial lists cannot blow up the output

__all__ = ["explain_finding"]


# ── small, defensive coercion helpers ──────────────────────────────────────────────────────────────

def _dedupe(items: list[str]) -> list[str]:
    """Order-preserving de-duplication of a list of strings."""
    return list(dict.fromkeys(items))


def _str_list(x: object) -> list[str]:
    """Coerce to a list of non-empty strings; anything else (incl. non-list) -> []. Fail-safe."""
    if not isinstance(x, (list, tuple)):
        return []
    return [s for s in x if isinstance(s, str) and s]


def _int_samples(x: object) -> list[int]:
    """Coerce an array of sample indices to finite non-negative ints; drop NaN/inf/bool/non-numeric."""
    if not isinstance(x, (list, tuple)):
        return []
    out: list[int] = []
    for v in x:
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        if v != v:  # NaN
            continue
        try:
            iv = int(v)
        except (ValueError, OverflowError):
            continue
        if iv >= 0:
            out.append(iv)
    return out


def _crit_text(c: dict) -> str:
    """Human phrase for one criterion: 'description (measuredValue)' or just the description/id."""
    desc = c.get("description") or c.get("id") or "criterion"
    mv = c.get("measuredValue")
    return f"{desc} ({mv})" if mv not in (None, "") else str(desc)


def _matched_criteria(finding: dict) -> list[dict]:
    """The finding's matched criteria (a criterion with no explicit `matched` flag counts as matched)."""
    return [c for c in (finding.get("criteria") or [])
            if isinstance(c, dict) and c.get("matched", True)]


# ── field builders (each assembles STRICTLY from the finding / ctx) ─────────────────────────────────

def _leads(finding: dict) -> list[str]:
    """Leads that ACTUALLY support this finding: from evidence[].lead + MATCHED criteria[].lead only
    (a criterion that did not fire must not be listed as contributing). STANDARD_12-ordered."""
    seen: list[str] = []
    for e in (finding.get("evidence") or []):
        if isinstance(e, dict) and isinstance(e.get("lead"), str) and e["lead"]:
            seen.append(e["lead"])
    for c in _matched_criteria(finding):
        if isinstance(c.get("lead"), str) and c["lead"]:
            seen.append(c["lead"])
    uniq = _dedupe(seen)
    return [l for l in STANDARD_12 if l in uniq] + [l for l in uniq if l not in STANDARD_12]


def _rules_passed(finding: dict) -> list[str]:
    """Descriptions of the matched criteria — the deterministic rules that fired for this finding."""
    out = [str(c.get("description") or c.get("id")) for c in _matched_criteria(finding)
           if (c.get("description") or c.get("id"))]
    return _dedupe(out)


def _measurements(finding: dict) -> list[dict]:
    """Named measured values from the criteria, each flagged whether it supports (matched) the finding.

    Only criteria that actually carry a measured value are emitted (0 / '0 mV' is a real value and kept);
    a criterion without a value is omitted rather than shown as an empty measurement.
    """
    out: list[dict] = []
    for c in (finding.get("criteria") or []):
        if not isinstance(c, dict):
            continue
        mv = c.get("measuredValue")
        if mv in (None, ""):
            continue
        name = c.get("description") or c.get("id")
        if not name:
            continue
        out.append({"name": str(name), "value": str(mv), "supports": bool(c.get("matched", True))})
    return out


def _why(finding: dict) -> str:
    """Plain-language sentence built ONLY from the label + matched criteria (no new claims)."""
    label = finding.get("label") or finding.get("id") or "This finding"
    matched = _matched_criteria(finding)
    parts = [_crit_text(c) for c in matched if (c.get("description") or c.get("id"))]
    if not parts:
        return f"{label}: no matched criteria are available to explain this finding."
    return f"{label} is supported by {'; '.join(parts)}."


def _confidence(finding: dict) -> float:
    """Echo the finding's confidence, clamped to [0, 1]; non-numeric -> 0.0 (never invents certainty)."""
    try:
        c = float(finding.get("confidence"))
    except (TypeError, ValueError):
        return 0.0
    if c != c:  # NaN
        return 0.0
    return round(max(0.0, min(1.0, c)), 3)


def _half_samples(fs: object) -> int:
    """Beat-window half-width in samples from `fs`; fall back to a fixed default when fs is unusable."""
    try:
        f = int(fs)
    except (TypeError, ValueError):
        return _DEFAULT_HALF_SAMPLES
    return max(1, int(_WINDOW_HALF_S * f)) if f > 0 else _DEFAULT_HALF_SAMPLES


def _global_beat_samples(measurements: dict, fs: object) -> list[int]:
    """Convert measurements.beats (seconds) to sample indices; [] unless BOTH beats and a valid fs exist."""
    beats = measurements.get("beats") if isinstance(measurements, dict) else None
    if not isinstance(beats, (list, tuple)) or not beats:
        return []
    try:
        f = int(fs)
    except (TypeError, ValueError):
        return []
    if f <= 0:
        return []
    out: list[int] = []
    for t in beats:
        if isinstance(t, bool) or not isinstance(t, (int, float)):
            continue
        if t != t or t < 0:  # NaN or negative
            continue
        out.append(int(round(t * f)))
    return out


_PAIR_KEYS = [("qrsOnset", "qrsOffset"), ("onset", "offset"), ("rOnset", "rOffset"), ("pOnset", "tOffset")]


def _onset_offset_pairs(d: dict) -> list[tuple[int, int]]:
    """First available (onset[], offset[]) fiducial pair from a delineation entry -> [(on, off), ...]."""
    for on_key, off_key in _PAIR_KEYS:
        ons, offs = _int_samples(d.get(on_key)), _int_samples(d.get(off_key))
        if ons and offs:
            pairs = [(on, off) for on, off in zip(ons, offs) if off > on >= 0]
            if pairs:
                return pairs
    return []


def _reason_for_lead(lead: str, matched: list[dict], evidence: list[dict], label: str) -> str:
    """Tie a highlight on `lead` to a matched criterion: prefer one naming the lead, else the first, else label."""
    for c in matched:
        if c.get("lead") == lead:
            return _crit_text(c)
    rule_ids = {e.get("ruleId") for e in evidence if e.get("lead") == lead}
    for c in matched:
        if c.get("id") in rule_ids:
            return _crit_text(c)
    if matched:
        return _crit_text(matched[0])
    return f"Region supporting {label}"


def _windows_for_lead(lead: str, delineation: object, global_beats: list[int], half: int, reason: str) -> list[dict]:
    """Highlight windows for one lead: delineation fiducials if present, else beat-centred fallback windows."""
    d = delineation.get(lead) if isinstance(delineation, dict) else None
    if isinstance(d, dict):
        pairs = _onset_offset_pairs(d)
        if pairs:
            return [{"lead": lead, "startSample": on, "endSample": off, "reason": reason} for on, off in pairs]
        beats = _int_samples(d.get("beats"))
        if beats:
            return [_beat_window(lead, b, half, reason) for b in beats]
    return [_beat_window(lead, b, half, reason) for b in global_beats]


def _beat_window(lead: str, beat: int, half: int, reason: str) -> dict:
    """A window centred on a beat sample, clamped so startSample never goes negative."""
    return {"lead": lead, "startSample": max(0, beat - half), "endSample": beat + half, "reason": reason}


def _abnormal_windows(finding: dict, ctx: dict, leads: list[str]) -> list[dict]:
    """Assemble abnormal windows on the evidence leads; [] when there is no delineation nor beats to draw."""
    delineation = ctx.get("delineation")
    fs = ctx.get("fs")
    measurements = ctx.get("measurements") or {}
    matched = _matched_criteria(finding)
    evidence = [e for e in (finding.get("evidence") or []) if isinstance(e, dict)]
    label = finding.get("label") or finding.get("id") or "finding"
    half = _half_samples(fs)
    global_beats = _global_beat_samples(measurements, fs)
    out: list[dict] = []
    for lead in leads:
        reason = _reason_for_lead(lead, matched, evidence, label)
        out.extend(_windows_for_lead(lead, delineation, global_beats, half, reason)[:_MAX_WINDOWS_PER_LEAD])
    return out


def _models(fusion: object, finding_id: object) -> tuple[list[str], list[str]]:
    """Split fusion sources into (agreed, disagreed) model names for this finding; ([], []) when absent.

    Understood shapes (checked in order): a per-finding override under fusion["perFinding"][id]; explicit
    fusion["agreed"]/["disagreed"] (aliases modelsAgreed/modelsDisagreed) string lists; or a fusion["sources"]
    list of names / {"name"/"source"/"model"/"label", "agrees": bool} split by an explicit `agrees` flag or a
    fusion["disagreement"] list of dissenting names. Only concretely-attributable names are emitted.
    """
    if not isinstance(fusion, dict):
        return [], []
    scope = fusion
    per = fusion.get("perFinding")
    if isinstance(per, dict) and isinstance(per.get(finding_id), dict):
        scope = per[finding_id]

    agreed = _str_list(scope.get("agreed") or scope.get("modelsAgreed"))
    disagreed = _str_list(scope.get("disagreed") or scope.get("modelsDisagreed"))
    if agreed or disagreed:
        return _dedupe(agreed), _dedupe(disagreed)

    dis_names = set(_str_list(scope.get("disagreement")))
    sources = scope.get("sources")
    if isinstance(sources, list):
        a: list[str] = []
        d: list[str] = []
        for s in sources:
            if isinstance(s, dict):
                name = s.get("name") or s.get("source") or s.get("model") or s.get("label")
                if not name:
                    continue
                name = str(name)
                (d if s.get("agrees") is False or name in dis_names else a).append(name)
            elif isinstance(s, str) and s:
                (d if s in dis_names else a).append(s)
        return _dedupe(a), _dedupe(d)
    return [], []


# ── public API ──────────────────────────────────────────────────────────────────────────────────────

def explain_finding(finding: dict, ctx: dict) -> dict:
    """Assemble the UI-ready explanation for one validated diagnosis. Invents nothing.

    Expected input:  `finding` — a validated diagnosis dict; `ctx` — the shared pipeline context
                     {measurements, st, rhythm, validated, fusion|None, delineation|None, fs|None}. A
                     non-dict ctx is treated as empty; missing keys degrade to safe defaults.
    Expected output: {
                       "why": str,                       # plain sentence from the matched criteria
                       "leads": [str],                   # evidence leads, STANDARD_12-ordered
                       "abnormalWindows": [{lead,startSample,endSample,reason}],  # regions + their reason
                       "measurements": [{name,value,supports}],                    # from the criteria
                       "rulesPassed": [str],             # matched-criteria descriptions
                       "modelsAgreed": [str],            # model/engine names concurring (from ctx.fusion)
                       "modelsDisagreed": [str],         # dissenting model/engine names
                       "regionHighlights": [{lead,startSample,endSample,label}],   # windows for the UI
                       "confidence": float,              # echoes finding.confidence, clamped to [0, 1]
                     }
    Failure modes:   `finding` not a dict -> KardioXError(code="bad_input", 400). No delineation and no
                     beats/fs -> abnormalWindows/regionHighlights are []. No fusion -> both model lists [].
    Boundary:        pure assembly/projection — no diagnosis and no measurement is computed here; any piece
                     of evidence that is absent is omitted, never fabricated.
    """
    if not isinstance(finding, dict):
        raise KardioXError("explain_finding requires a validated finding dict", stage=_STAGE,
                           code="bad_input", http=400)
    ctx = ctx if isinstance(ctx, dict) else {}

    leads = _leads(finding)
    abnormal = _abnormal_windows(finding, ctx, leads)
    label = finding.get("label") or finding.get("id") or "finding"
    highlights = [{"lead": w["lead"], "startSample": w["startSample"], "endSample": w["endSample"],
                   "label": label} for w in abnormal]
    agreed, disagreed = _models(ctx.get("fusion"), finding.get("id"))

    return {
        "why": _why(finding),
        "leads": leads,
        "abnormalWindows": abnormal,
        "measurements": _measurements(finding),
        "rulesPassed": _rules_passed(finding),
        "modelsAgreed": agreed,
        "modelsDisagreed": disagreed,
        "regionHighlights": highlights,
        "confidence": _confidence(finding),
    }
