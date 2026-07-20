"""Serial ECG comparison — deterministic clinical diff of two analyses (current vs prior).

REAL, model-free comparison. Given two analysis-like objects it reports which findings are NEW,
RESOLVED or PERSISTED, the signed deltas of the key measurements/ST burden, a set of clinically
meaningful change flags, and a single trend verdict. Nothing is inferred by a model and no
measurement is ever fabricated: a value that is absent on either side yields a `None` delta plus an
explanatory note. Finding LABELS are compared case-insensitively.

A learned serial-trend / deterioration-risk model would be the ML analogue of this diff; that hook
(`predict_trend_model`) ships no weights and raises UpstreamUnavailable — it never fakes a verdict.

Clinically meaningful thresholds (documented constants below):
  QTC_DELTA_MS   = 30   |ΔQTc| beyond this is significant → qtProlongationChange
  AXIS_SHIFT_DEG = 45   |Δaxis| beyond this is a real axis shift → axisShift
  ST_DELTA_MV    = 0.1  per-lead |ΔST| (~1 mm) beyond this is a real ST change → stChange
  RATE_DELTA_BPM = 20   |Δrate| beyond this warrants a note

Expected input:  compare(current, prior) — each an analysis-like dict (or object) with any of
    {"measurements": <measurements|ECGMeasurements>, "diagnoses"|"findings": [...], "st": <st>}.
    Missing keys are tolerated.
Expected output: {"newFindings","resolvedFindings","persistedFindings": [str],
    "deltas": {"ventRateBpm","qtcMs","axisDeg","stMaxMv": float|None},
    "flags": {"newAF","newBBB","qtProlongationChange","stChange","axisShift","dynamicIschemia": bool},
    "trend": "improved"|"worsened"|"stable"|"indeterminate", "notes": [str]}.
Failure modes:  a non-analysis-like current/prior (str/number/list/None) raises KardioXError(bad_input);
    absent measurements/ST → the corresponding delta is None and a note is appended; the function
    never raises on missing keys or partial data.
Boundary:  the diff logic + thresholds are real and standard; the thresholds are conservative
    decision-support values and should be reviewed against a labelled serial-ECG set before the
    result is used to drive any automated escalation.
"""
from __future__ import annotations

from typing import Any, Callable

from app.core.errors import KardioXError, UpstreamUnavailable

QTC_DELTA_MS = 30.0      # |ΔQTc| beyond this is clinically meaningful
AXIS_SHIFT_DEG = 45.0    # |Δaxis| beyond this is a real axis shift
ST_DELTA_MV = 0.1        # per-lead |ΔST| (~1 mm) beyond this is a real ST change
RATE_DELTA_BPM = 20.0    # |Δrate| beyond this warrants a note

_SEVERE = frozenset({"critical", "urgent"})
_MEAS_KEYS = ("ventRateBpm", "heartRate", "prMs", "qrsMs", "qtMs", "qtcMs", "qtcFridericiaMs", "axisDeg")


# ── tolerant accessors (work on dicts or ECGMeasurements/ECGAnalysis-like objects) ────────────────
def _get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _num(v: Any) -> float | None:
    """Coerce to float; bool/None/non-numeric-str -> None (never fabricate a value)."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip())
        except ValueError:
            return None
    return None


def _is_analysis_like(obj: Any) -> bool:
    if obj is None:
        return False
    if isinstance(obj, (str, bytes, bytearray, int, float, bool, list, tuple, set, frozenset)):
        return False
    return True


def _entries(analysis: Any) -> list[tuple[str, str]]:
    """Ordered, de-duplicated (label, severity_lower) pairs from a diagnoses (preferred) or findings list.

    Accepts dict/object items (`label`/`title`/`id` + optional `severity`) or plain-string labels.
    """
    items = _get(analysis, "diagnoses")
    if not items:
        items = _get(analysis, "findings")
    if not isinstance(items, (list, tuple)):
        return []
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for it in items:
        if isinstance(it, str):
            label: Any = it
            sev = ""
        else:
            label = _get(it, "label") or _get(it, "title") or _get(it, "id")
            sev = str(_get(it, "severity") or "").strip().lower()
        if label is None:
            continue
        label = str(label).strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append((label, sev))
    return out


def _vent_rate(analysis: Any) -> float | None:
    m = _get(analysis, "measurements")
    if m is None:
        return None
    v = _get(m, "ventRateBpm")
    if v is None:
        v = _get(m, "heartRate")
    return _num(v)


def _meas_num(analysis: Any, key: str) -> float | None:
    m = _get(analysis, "measurements")
    return _num(_get(m, key)) if m is not None else None


def _st_perlead(analysis: Any) -> dict[str, float]:
    st = _get(analysis, "st")
    per = _get(st, "perLead") if st is not None else None
    out: dict[str, float] = {}
    if isinstance(per, dict):
        for lead, v in per.items():
            n = _num(v)
            if n is not None:
                out[str(lead)] = n
    return out


def _st_max_abs(per: dict[str, float]) -> float | None:
    if not per:
        return None
    return max(abs(v) for v in per.values())


def _delta(cur: float | None, pri: float | None, ndigits: int) -> float | None:
    if cur is None or pri is None:
        return None
    return round(float(cur) - float(pri), ndigits)


def _has_data(analysis: Any) -> bool:
    if _entries(analysis):
        return True
    m = _get(analysis, "measurements")
    if m is not None and any(_get(m, k) is not None for k in _MEAS_KEYS):
        return True
    return bool(_st_perlead(analysis))


# ── label classifiers (input already lower-cased) ─────────────────────────────────────────────────
def _is_af(label: str) -> bool:
    return ("atrial fibrillation" in label or "afib" in label or label == "af"
            or label.startswith("af ") or label.endswith(" af") or " af " in label)


def _is_bbb(label: str) -> bool:
    return ("bundle branch" in label or "bbb" in label or "ivcd" in label
            or "intraventricular conduction" in label)


def _is_ischemia(label: str) -> bool:
    return any(k in label for k in ("st elevation", "st depression", "ischemi", "stemi", "infarct", "injury"))


def _any(labels: set[str], pred: Callable[[str], bool]) -> bool:
    return any(pred(l) for l in labels)


def _missing_note(name: str, cur: float | None, pri: float | None) -> str:
    where = ("both ECGs" if cur is None and pri is None
             else "the current ECG" if cur is None else "the prior ECG")
    return f"{name} unavailable in {where}; delta not computed."


def compare(current: dict, prior: dict) -> dict:
    """Deterministic serial diff of two analyses. See module docstring for shapes/thresholds.

    Expected input:  `current`, `prior` — analysis-like dicts/objects (missing keys tolerated).
    Expected output: the serial-diff dict (newFindings/resolvedFindings/persistedFindings, deltas,
                     flags, trend, notes) described in the module docstring.
    Failure modes:   non-analysis-like input -> KardioXError(code="bad_input", http=400); a missing
                     measurement/ST value -> that delta is None + an explanatory note (never raises).
    Boundary:        thresholds are conservative decision-support values, not validated escalation
                     triggers.
    """
    for name, obj in (("current", current), ("prior", prior)):
        if not _is_analysis_like(obj):
            raise KardioXError(f"serial.compare: `{name}` must be an analysis-like mapping/object",
                               stage="serial", code="bad_input", http=400)

    # findings diff (case-insensitive on labels; order preserved from the source list)
    cur_entries = _entries(current)
    pri_entries = _entries(prior)
    cur_sev = {lbl.lower(): sev for lbl, sev in cur_entries}
    pri_sev = {lbl.lower(): sev for lbl, sev in pri_entries}
    cur_lower = set(cur_sev)
    pri_lower = set(pri_sev)

    new_labels = [lbl for lbl, _ in cur_entries if lbl.lower() not in pri_lower]
    resolved_labels = [lbl for lbl, _ in pri_entries if lbl.lower() not in cur_lower]
    persisted_labels = [lbl for lbl, _ in cur_entries if lbl.lower() in pri_lower]
    new_lower = {lbl.lower() for lbl in new_labels}
    resolved_lower = {lbl.lower() for lbl in resolved_labels}

    # measurement + ST-burden deltas (None when absent on either side)
    cur_rate, pri_rate = _vent_rate(current), _vent_rate(prior)
    cur_qtc, pri_qtc = _meas_num(current, "qtcMs"), _meas_num(prior, "qtcMs")
    cur_axis, pri_axis = _meas_num(current, "axisDeg"), _meas_num(prior, "axisDeg")
    cur_st, pri_st = _st_perlead(current), _st_perlead(prior)
    cur_stmax, pri_stmax = _st_max_abs(cur_st), _st_max_abs(pri_st)

    d_rate = _delta(cur_rate, pri_rate, 1)
    d_qtc = _delta(cur_qtc, pri_qtc, 1)
    d_axis = _delta(cur_axis, pri_axis, 1)
    d_stmax = _delta(cur_stmax, pri_stmax, 3)

    # per-lead ST change over leads measured on BOTH sides (missing lead is NOT assumed 0 mV)
    common = set(cur_st) & set(pri_st)
    lead_deltas = {l: cur_st[l] - pri_st[l] for l in common}
    st_change = any(abs(dv) > ST_DELTA_MV for dv in lead_deltas.values())
    st_worsening = any((dv > ST_DELTA_MV and cur_st[l] >= 0.1) or (dv < -ST_DELTA_MV and cur_st[l] <= -0.1)
                       for l, dv in lead_deltas.items())
    st_improving = any((dv < -ST_DELTA_MV and pri_st[l] >= 0.1) or (dv > ST_DELTA_MV and pri_st[l] <= -0.1)
                       for l, dv in lead_deltas.items())
    new_isch = _any(new_lower, _is_ischemia)
    resolved_isch = _any(resolved_lower, _is_ischemia)

    # flags
    new_af = _any(cur_lower, _is_af) and not _any(pri_lower, _is_af)
    new_bbb = _any(cur_lower, _is_bbb) and not _any(pri_lower, _is_bbb)
    # prolongation is a POSITIVE change beyond threshold; a large shortening is significant but is NOT
    # "prolongation" (it typically reflects improvement / a different cause) — keep the flag precise.
    qt_prolongation_change = d_qtc is not None and d_qtc > QTC_DELTA_MS
    qt_significant = d_qtc is not None and abs(d_qtc) > QTC_DELTA_MS
    axis_shift = d_axis is not None and abs(d_axis) > AXIS_SHIFT_DEG
    dynamic_ischemia = st_worsening or new_isch

    qt_worsened = d_qtc is not None and d_qtc > QTC_DELTA_MS
    qt_improved = d_qtc is not None and d_qtc < -QTC_DELTA_MS
    rate_change = d_rate is not None and abs(d_rate) > RATE_DELTA_BPM
    new_severe = any(cur_sev.get(k) in _SEVERE for k in new_lower)
    resolved_severe = any(pri_sev.get(k) in _SEVERE for k in resolved_lower)

    # trend — worsening dominates a mixed picture; a change we cannot direction-classify is indeterminate.
    have_cur, have_pri = _has_data(current), _has_data(prior)
    worsened = new_severe or qt_worsened or dynamic_ischemia or new_af  # new AF is treated as urgent-equivalent
    improved = resolved_severe or qt_improved or resolved_isch or st_improving
    significant = qt_significant or axis_shift or st_change or rate_change
    any_change = bool(new_labels or resolved_labels) or significant

    if not (have_cur and have_pri):
        trend = "indeterminate"
    elif worsened:
        trend = "worsened"
    elif improved:
        trend = "improved"
    elif not any_change:
        trend = "stable"
    else:
        trend = "indeterminate"

    # notes — every None delta is explained; significant deltas + flags are surfaced.
    notes: list[str] = []
    if d_rate is None:
        notes.append(_missing_note("Ventricular rate", cur_rate, pri_rate))
    elif rate_change:
        notes.append(f"Ventricular rate changed by {d_rate:+.0f} bpm ({pri_rate:.0f} -> {cur_rate:.0f}).")
    if d_qtc is None:
        notes.append(_missing_note("QTc", cur_qtc, pri_qtc))
    elif qt_prolongation_change:
        notes.append(f"QTc prolonged by {d_qtc:+.0f} ms (threshold {QTC_DELTA_MS:.0f} ms); review QT-prolonging drugs and electrolytes.")
    elif qt_significant:
        notes.append(f"QTc shortened by {abs(d_qtc):.0f} ms (threshold {QTC_DELTA_MS:.0f} ms).")
    if d_axis is None:
        notes.append(_missing_note("QRS axis", cur_axis, pri_axis))
    elif axis_shift:
        notes.append(f"QRS axis shifted by {d_axis:+.0f} deg (threshold {AXIS_SHIFT_DEG:.0f} deg).")
    if d_stmax is None:
        notes.append("ST deviation unavailable in one or both ECGs; ST delta not computed.")
    elif st_change:
        leads = ", ".join(sorted(l for l, dv in lead_deltas.items() if abs(dv) > ST_DELTA_MV))
        notes.append(f"ST deviation changed > {ST_DELTA_MV:.1f} mV in lead(s): {leads}.")
    if dynamic_ischemia:
        notes.append("Dynamic ST change vs prior; correlate with symptoms and troponin (possible evolving ischemia).")
    if new_af:
        notes.append("New atrial fibrillation vs prior ECG; assess rate/rhythm control and anticoagulation.")
    if new_bbb:
        notes.append("New bundle-branch block / IVCD vs prior ECG; exclude rate-related aberrancy and ischemia.")
    if not (have_cur and have_pri):
        notes.append("Insufficient overlapping data between the two ECGs to determine a trend.")

    return {
        "newFindings": new_labels,
        "resolvedFindings": resolved_labels,
        "persistedFindings": persisted_labels,
        "deltas": {"ventRateBpm": d_rate, "qtcMs": d_qtc, "axisDeg": d_axis, "stMaxMv": d_stmax},
        "flags": {"newAF": new_af, "newBBB": new_bbb, "qtProlongationChange": qt_prolongation_change,
                  "stChange": st_change, "axisShift": axis_shift, "dynamicIschemia": dynamic_ischemia},
        "trend": trend,
        "notes": notes,
    }


def predict_trend_model(current: dict, prior: dict) -> dict:
    """Learned serial-trend / deterioration-risk hook — NOT wired (honest boundary).

    A trustworthy learned trend/risk model requires training on labelled serial-ECG cohorts, versioned
    serving, and clinical validation; KardioX ships no such weights. This hook therefore always raises
    UpstreamUnavailable rather than fabricate a verdict. Use `compare()` for the deterministic diff.

    Expected input:  `current`, `prior` — analysis-like objects (unused; validated by `compare`).
    Expected output: never returns.
    Failure modes:   always raises UpstreamUnavailable(stage="serial") — the safe "Not Ready" state.
    Boundary:        activate only once a validated checkpoint + serving path exist.
    """
    raise UpstreamUnavailable(
        "Serial-trend ML model is not wired: KardioX ships no weights. Use serial.compare() for the "
        "deterministic diff; a learned deterioration-risk model needs training on labelled serial-ECG "
        "cohorts plus clinical validation before activation.",
        stage="serial")
