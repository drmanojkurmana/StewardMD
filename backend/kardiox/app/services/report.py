"""Stage 13 — Clinical report assembly + FHIR R4 export + printable HTML/PDF (Phase 6).

Pure-python, deterministic report layer that turns a finished ECGAnalysis into the artifacts a
clinician / EHR consumes. It NEVER computes or infers anything clinical: it only re-shapes facts that
are already in the analysis (verdict, measurements, matched rule findings, differentials). Nothing here
fabricates a value, a code, or a diagnosis.

Public API
  build_report(analysis)  -> dict   structured, section-per-key report (the app / renderers consume this)
  to_fhir(analysis)       -> dict   FHIR R4 Bundle (collection): DiagnosticReport + Observation resources
  render_html(report)     -> str    deterministic printable HTML (frontend can print-to-PDF) - always works
  render_pdf(report)      -> bytes  attempts reportlab; if absent raises UpstreamUnavailable (honest hook)

Expected input:  analysis - an ECGAnalysis-like dict (see app.models.ecg.ECGAnalysis): verdict, severity,
    confidence, measurements, morphology, findings, differentials, whatToVerify, clinicalInterpretation,
    plus optional qualityReport / signalQuality. render_html/render_pdf accept a build_report() output
    (and, defensively, a raw analysis - they will build the report first).
Expected output: see per-function docstrings.
Failure modes:   non-dict input -> KardioXError(invalid_input, 400). render_pdf without reportlab ->
    UpstreamUnavailable(stage="report"). No stage ever raises on partial/None fields - missing data is
    simply omitted from the report (fail-safe).
Boundary:        LOINC is asserted ONLY where well-established (heart rate 8867-4). Every other interval /
    axis Observation uses the local system "https://stewardmd.in/fhir/kardiox" and says so in code.text,
    rather than guessing an official code. The mandated disclaimer is attached to every report + Bundle.
"""
from __future__ import annotations

import html
from typing import Any

from app.core.errors import KardioXError, UpstreamUnavailable

# The disclaimer that MUST appear on every artifact (regulatory posture: decision support, not a device).
DISCLAIMER = "AI decision support - not a diagnosis. Confirm clinically."

# Local coding system for measurements that have no LOINC code we are confident enough to assert.
KARDIOX_FHIR_SYSTEM = "https://stewardmd.in/fhir/kardiox"
_LOINC = "http://loinc.org"
_UCUM = "http://unitsofmeasure.org"

# key candidates (first present wins), label, unit, UCUM code, LOINC code|None, local code.
# LOINC is set ONLY for heart rate (8867-4) - the one code we are certain of; everything else is local.
_MEAS_SPECS: tuple[tuple[tuple[str, ...], str, str, str, str | None, str], ...] = (
    (("heartRate", "ventRateBpm", "rateBpm"), "Heart rate", "beats/minute", "/min", "8867-4", "heart-rate"),
    (("prMs",), "PR interval", "ms", "ms", None, "pr-interval-ms"),
    (("qrsMs",), "QRS duration", "ms", "ms", None, "qrs-duration-ms"),
    (("qtMs",), "QT interval", "ms", "ms", None, "qt-interval-ms"),
    (("qtcMs",), "QTc interval", "ms", "ms", None, "qtc-interval-ms"),
    (("qtcFridericiaMs",), "QTc (Fridericia)", "ms", "ms", None, "qtc-fridericia-ms"),
    (("axisDeg",), "QRS axis", "degree", "deg", None, "qrs-axis-deg"),
)


# ── input coercion helpers (fail-safe: never raise on odd field types) ─────────────────────────────
def _num(value: Any) -> float | int | None:
    """Coerce to a number (int when whole), else None. Never raises."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):  # NaN / inf guard
        return None
    return int(f) if f.is_integer() else round(f, 3)


def _pick_num(source: dict, keys: tuple[str, ...]) -> float | int | None:
    for k in keys:
        n = _num(source.get(k))
        if n is not None:
            return n
    return None


def _str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return value if isinstance(value, str) else str(value)


def _require_dict(obj: Any, what: str) -> dict:
    if not isinstance(obj, dict):
        raise KardioXError(f"{what} must be a dict", stage="report", code="invalid_input", http=400)
    return obj


def _band(confidence: float) -> str:
    return "high" if confidence >= 0.85 else "medium" if confidence >= 0.6 else "low"


# ── build_report ───────────────────────────────────────────────────────────────────────────────────
def build_report(analysis: dict) -> dict:
    """Assemble the structured clinical report from a finished analysis.

    Expected input:  ECGAnalysis-like dict.
    Expected output: dict with keys imageQuality, signalQuality, measurements, interpretation, confidence,
        evidence, differentials, cautions, followUp. `cautions` ALWAYS begins with DISCLAIMER.
    Failure modes:   non-dict analysis -> KardioXError(invalid_input, 400). Missing sub-fields are omitted.
    Boundary:        no clinical value is computed here - only re-shaped from the analysis.
    """
    a = _require_dict(analysis, "analysis")
    meas = a.get("measurements") if isinstance(a.get("measurements"), dict) else {}

    confidence = _num(a.get("confidence")) or 0.0
    band = _str(a.get("confidenceBand")) or _band(float(confidence))
    capped = bool(a.get("confidenceCapped"))

    return {
        "imageQuality": _image_quality_section(a),
        "signalQuality": _signal_quality_section(a),
        "measurements": _measurement_rows(meas),
        "interpretation": {
            "verdict": _str(a.get("verdict")),
            "qualifier": _str(a.get("verdictQualifier")) or None,
            "severity": _str(a.get("severity")) or "info",
            "clinicalInterpretation": _str(a.get("clinicalInterpretation")),
            "morphology": _morphology_rows(a.get("morphology")),
        },
        "confidence": {"value": round(float(confidence), 2), "band": band, "capped": capped},
        "evidence": _evidence_rows(a.get("findings")),
        "differentials": _differential_rows(a.get("differentials")),
        "cautions": _cautions(a, float(confidence), capped),
        "followUp": _follow_up(a),
    }


def _image_quality_section(a: dict) -> dict:
    q = a.get("qualityReport") or a.get("imageQuality")
    if not isinstance(q, dict):
        return {"available": False}
    reasons = q.get("reasons")
    reasons = reasons if isinstance(reasons, list) else []
    return {
        "available": True,
        "score": _num(q.get("score")),
        "pass": bool(q.get("pass")) if "pass" in q else None,
        "reasons": [_str(r) for r in reasons],
        "metrics": q.get("metrics") if isinstance(q.get("metrics"), dict) else {},
    }


def _signal_quality_section(a: dict) -> dict:
    sq = a.get("signalQuality")
    if sq is None:
        meas = a.get("measurements")
        sq = meas.get("quality") if isinstance(meas, dict) else None
    if sq is None:
        return {"available": False}
    if isinstance(sq, dict):
        return {"available": True, **sq}
    n = _num(sq)
    return {"available": True, "value": n if n is not None else _str(sq)}


def _measurement_rows(meas: dict) -> list[dict]:
    rows: list[dict] = []
    rhythm = _str(meas.get("rhythm"))
    if rhythm:
        rows.append({"key": "rhythm", "label": "Rhythm", "value": rhythm, "unit": ""})
    for keys, label, unit, _ucum, _loinc, code in _MEAS_SPECS:
        n = _pick_num(meas, keys)
        if n is not None:
            rows.append({"key": code, "label": label, "value": n, "unit": "bpm" if unit == "beats/minute" else unit})
    return rows


def _morphology_rows(morphology: Any) -> list[dict]:
    if not isinstance(morphology, list):
        return []
    out: list[dict] = []
    for row in morphology:
        if isinstance(row, dict) and row.get("label") is not None:
            out.append({"label": _str(row.get("label")), "value": _str(row.get("value"))})
    return out


def _evidence_rows(findings: Any) -> list[dict]:
    if not isinstance(findings, list):
        return []
    out: list[dict] = []
    for f in findings:
        if not isinstance(f, dict):
            continue
        ev = f.get("evidence") or []
        first = ev[0] if isinstance(ev, list) and ev and isinstance(ev[0], dict) else {}
        out.append({
            "title": _str(f.get("title")),
            "detail": _str(f.get("detail")),
            "severity": _str(f.get("severity")) or "info",
            "weight": _num(f.get("weight")),
            "lead": _str(first.get("lead")),
            "ruleId": _str(first.get("ruleId")),
            "measuredValue": _str(first.get("measuredValue")) or _str(f.get("detail")),
        })
    return out


def _differential_rows(differentials: Any) -> list[dict]:
    if not isinstance(differentials, list):
        return []
    out: list[dict] = []
    for d in differentials:
        if isinstance(d, dict) and d.get("label") is not None:
            out.append({"label": _str(d.get("label")), "probability": _num(d.get("probability")) or 0.0})
    return out


def _cautions(a: dict, confidence: float, capped: bool) -> list[str]:
    """The mandated disclaimer FIRST, then any real safety cautions derived from the analysis facts."""
    cautions = [DISCLAIMER]
    rf = a.get("redFlag")
    if isinstance(rf, dict) and (rf.get("title") or rf.get("body")):
        title, body = _str(rf.get("title")), _str(rf.get("body"))
        cautions.append(f"{title}: {body}".strip(": ").strip())
    if capped:
        cautions.append("Confidence was capped due to conflicting findings - review manually.")
    if confidence and confidence < 0.6:
        cautions.append("Low model confidence - interpret with additional caution.")
    q = a.get("qualityReport") or a.get("imageQuality")
    if isinstance(q, dict) and q.get("pass") is False:
        cautions.append("Image quality was flagged - measurements may be unreliable.")
    return cautions


def _follow_up(a: dict) -> dict:
    rf = a.get("redFlag")
    red = None
    if isinstance(rf, dict) and (rf.get("title") or rf.get("body")):
        red = {"title": _str(rf.get("title")), "body": _str(rf.get("body"))}
    return {"whatToVerify": _str(a.get("whatToVerify")), "redFlag": red}


# ── to_fhir ───────────────────────────────────────────────────────────────────────────────────────
def to_fhir(analysis: dict) -> dict:
    """Build a FHIR R4 Bundle (type collection) with a DiagnosticReport + measurement Observations.

    Expected input:  ECGAnalysis-like dict.
    Expected output: {"resourceType":"Bundle","type":"collection","entry":[...]} - a DiagnosticReport
        (category cardiology, status preliminary, conclusion = verdict + disclaimer) followed by one
        Observation per present measurement.
    Failure modes:   non-dict analysis -> KardioXError(invalid_input, 400). Absent measurements simply
        produce no Observation for that value.
    Boundary:        HR uses LOINC 8867-4; all other values use the local KardioX system (stated in
        code.text). No official code is guessed. No value is fabricated - only what is in `analysis`.
    """
    a = _require_dict(analysis, "analysis")
    meas = a.get("measurements") if isinstance(a.get("measurements"), dict) else {}
    verdict = _str(a.get("verdict"))
    conclusion = f"{verdict.rstrip('. ')}. {DISCLAIMER}" if verdict else DISCLAIMER

    observations = _fhir_observations(meas)
    report_resource = {
        "resourceType": "DiagnosticReport",
        "id": "kardiox-ecg-report",
        "status": "preliminary",
        "category": [{
            "coding": [{"system": KARDIOX_FHIR_SYSTEM, "code": "cardiology", "display": "Cardiology"}],
            "text": "cardiology",
        }],
        # Local code for the study itself: honest rather than asserting a LOINC panel code we are unsure of.
        "code": {
            "coding": [{"system": KARDIOX_FHIR_SYSTEM, "code": "ecg-12-lead-interpretation",
                        "display": "12-lead ECG interpretation"}],
            "text": "12-lead ECG interpretation (KardioX local code)",
        },
        "conclusion": conclusion,
        "result": [{"reference": f"Observation/{o['id']}"} for o in observations],
    }

    entries = [{"resource": report_resource}] + [{"resource": o} for o in observations]
    return {"resourceType": "Bundle", "type": "collection", "entry": entries}


def _fhir_observations(meas: dict) -> list[dict]:
    out: list[dict] = []
    for keys, label, unit, ucum, loinc, code in _MEAS_SPECS:
        n = _pick_num(meas, keys)
        if n is None:
            continue
        if loinc:
            coding = {"system": _LOINC, "code": loinc, "display": label}
            text = label
        else:
            coding = {"system": KARDIOX_FHIR_SYSTEM, "code": code, "display": label}
            text = f"{label} (KardioX local code, not an official LOINC)"
        out.append({
            "resourceType": "Observation",
            "id": code,
            "status": "preliminary",
            "code": {"coding": [coding], "text": text},
            "valueQuantity": {"value": n, "unit": unit, "system": _UCUM, "code": ucum},
        })
    return out


# ── rendering ─────────────────────────────────────────────────────────────────────────────────────
def _as_report(obj: dict) -> dict:
    """Accept a build_report() output, or defensively a raw analysis (build it first)."""
    d = _require_dict(obj, "report")
    if "interpretation" not in d and "verdict" in d:
        return build_report(d)
    return d


def _plain_lines(report: dict) -> list[str]:
    """Deterministic plain-text lines shared by HTML/PDF renderers (order is stable)."""
    r = report
    interp = r.get("interpretation", {}) if isinstance(r.get("interpretation"), dict) else {}
    conf = r.get("confidence", {}) if isinstance(r.get("confidence"), dict) else {}
    verdict = _str(interp.get("verdict")) or "(no verdict)"
    qualifier = _str(interp.get("qualifier"))

    lines: list[str] = ["KardioX ECG Report"]
    lines.append(f"Verdict: {verdict}" + (f" - {qualifier}" if qualifier else ""))
    lines.append(f"Severity: {_str(interp.get('severity')) or 'info'}   "
                 f"Confidence: {conf.get('value', 0)} ({_str(conf.get('band')) or 'low'})")
    if interp.get("clinicalInterpretation"):
        lines += ["", "Interpretation:", _str(interp.get("clinicalInterpretation"))]

    meas = r.get("measurements") or []
    if isinstance(meas, list) and meas:
        lines += ["", "Measurements:"]
        for m in meas:
            unit = f" {m.get('unit')}" if m.get("unit") else ""
            lines.append(f"  - {_str(m.get('label'))}: {m.get('value')}{unit}")

    ev = r.get("evidence") or []
    if isinstance(ev, list) and ev:
        lines += ["", "Evidence:"]
        for e in ev:
            lead = f" [{_str(e.get('lead'))}]" if e.get("lead") else ""
            lines.append(f"  - {_str(e.get('title'))}: {_str(e.get('measuredValue'))}{lead}")

    diffs = r.get("differentials") or []
    if isinstance(diffs, list) and diffs:
        lines += ["", "Differentials:"]
        for d in diffs:
            lines.append(f"  - {_str(d.get('label'))} ({d.get('probability')})")

    fu = r.get("followUp") or {}
    if isinstance(fu, dict) and fu.get("whatToVerify"):
        lines += ["", "What to verify:", _str(fu.get("whatToVerify"))]

    cautions = r.get("cautions") or [DISCLAIMER]
    lines += ["", "Cautions:"]
    lines += [f"  - {_str(c)}" for c in cautions]
    return lines


def render_html(report: dict) -> str:
    """Render a clean, self-contained printable HTML document (no external assets).

    Expected input:  build_report() output (a raw analysis is also accepted defensively).
    Expected output: an HTML string that contains the verdict and the DISCLAIMER. Deterministic; never
        raises on partial data.
    Failure modes:   non-dict input -> KardioXError(invalid_input, 400).
    Boundary:        purely presentational - all HTML is escaped; the frontend can print this to PDF.
    """
    r = _as_report(report)
    interp = r.get("interpretation", {}) if isinstance(r.get("interpretation"), dict) else {}
    conf = r.get("confidence", {}) if isinstance(r.get("confidence"), dict) else {}
    e = html.escape
    verdict = e(_str(interp.get("verdict")) or "(no verdict)")
    qualifier = _str(interp.get("qualifier"))
    severity = e(_str(interp.get("severity")) or "info")

    parts: list[str] = [
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8">',
        "<title>KardioX ECG Report</title>",
        "<style>"
        "body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#12202b;"
        "margin:24px;line-height:1.45}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;"
        "text-transform:uppercase;letter-spacing:.04em;color:#5b6b78;margin:20px 0 6px;"
        "border-bottom:1px solid #e3e8ec;padding-bottom:3px}table{border-collapse:collapse;width:100%}"
        "td,th{text-align:left;padding:4px 8px;border-bottom:1px solid #eef1f3;font-size:13px}"
        ".verdict{font-size:18px;font-weight:600}.sev{display:inline-block;padding:1px 8px;border-radius:10px;"
        "background:#eef1f3;font-size:12px}.disclaimer{margin-top:22px;padding:10px 12px;background:#fff7e6;"
        "border:1px solid #ffd591;border-radius:8px;font-size:12px}ul{margin:4px 0;padding-left:18px}"
        "@media print{body{margin:0}}"
        "</style></head><body>",
        "<h1>KardioX ECG Report</h1>",
        f'<p class="verdict">{verdict}' + (f" <small>{e(qualifier)}</small>" if qualifier else "") + "</p>",
        f'<p><span class="sev">{severity}</span> &middot; confidence '
        f"{e(str(conf.get('value', 0)))} ({e(_str(conf.get('band')) or 'low')})</p>",
    ]

    if interp.get("clinicalInterpretation"):
        parts.append("<h2>Interpretation</h2>")
        parts.append(f"<p>{e(_str(interp.get('clinicalInterpretation')))}</p>")

    parts.append(_html_table("Measurements", r.get("measurements") or [],
                             lambda m: (e(_str(m.get("label"))),
                                        f"{e(str(m.get('value')))} {e(_str(m.get('unit')))}".strip())))

    morph = interp.get("morphology") or []
    if isinstance(morph, list) and morph:
        parts.append(_html_table("Morphology", morph,
                                 lambda m: (e(_str(m.get("label"))), e(_str(m.get("value"))))))

    ev = r.get("evidence") or []
    if isinstance(ev, list) and ev:
        parts.append("<h2>Evidence</h2><table>")
        for item in ev:
            lead = f" [{e(_str(item.get('lead')))}]" if item.get("lead") else ""
            parts.append(f"<tr><td>{e(_str(item.get('title')))}</td>"
                         f"<td>{e(_str(item.get('measuredValue')))}{lead}</td></tr>")
        parts.append("</table>")

    diffs = r.get("differentials") or []
    if isinstance(diffs, list) and diffs:
        parts.append(_html_table("Differentials", diffs,
                                 lambda d: (e(_str(d.get("label"))), e(str(d.get("probability"))))))

    fu = r.get("followUp") or {}
    if isinstance(fu, dict) and fu.get("whatToVerify"):
        parts.append("<h2>What to verify</h2>")
        parts.append(f"<p>{e(_str(fu.get('whatToVerify')))}</p>")

    cautions = r.get("cautions") or [DISCLAIMER]
    parts.append('<div class="disclaimer"><strong>Cautions</strong><ul>')
    parts += [f"<li>{e(_str(c))}</li>" for c in cautions]
    parts.append("</ul></div>")

    parts.append("</body></html>")
    return "".join(parts)


def _html_table(title: str, rows: list, cells) -> str:
    if not isinstance(rows, list) or not rows:
        return ""
    body = "".join(f"<tr><td>{a}</td><td>{b}</td></tr>" for a, b in (cells(x) for x in rows))
    return f"<h2>{html.escape(title)}</h2><table>{body}</table>"


def render_pdf(report: dict) -> bytes:
    """Render the report to a PDF using reportlab.

    Expected input:  build_report() output (a raw analysis is also accepted defensively).
    Expected output: PDF file bytes (starting with b"%PDF").
    Failure modes:   reportlab not installed -> UpstreamUnavailable(stage="report") - an HONEST "not
        ready" hook; this function NEVER fabricates a PDF. Non-dict input -> KardioXError(invalid_input).
    Boundary:        content mirrors render_html; layout is intentionally simple + deterministic.
    """
    r = _as_report(report)
    canvas, LETTER = _lazy_reportlab()
    import io

    buf = io.BytesIO()
    page_w, page_h = LETTER
    c = canvas.Canvas(buf, pagesize=LETTER)
    x, y = 54, page_h - 54
    for raw in _plain_lines(r):
        line = raw if raw else " "
        if line == "KardioX ECG Report":
            c.setFont("Helvetica-Bold", 15)
        elif line.endswith(":") and not line.startswith("  "):
            c.setFont("Helvetica-Bold", 11)
        else:
            c.setFont("Helvetica", 10)
        for chunk in _wrap(line, 96):
            if y < 54:
                c.showPage()
                y = page_h - 54
            c.drawString(x, y, chunk)
            y -= 15
    c.showPage()
    c.save()
    return buf.getvalue()


def _wrap(text: str, width: int) -> list[str]:
    """Deterministic width-wrap that preserves leading indentation."""
    if len(text) <= width:
        return [text]
    indent = text[: len(text) - len(text.lstrip())]
    words, out, cur = text.split(), [], ""
    for w in words:
        candidate = f"{cur} {w}".strip()
        if len(indent + candidate) > width and cur:
            out.append(indent + cur)
            cur = w
        else:
            cur = candidate
    if cur:
        out.append(indent + cur)
    return out or [text]


def _lazy_reportlab():
    try:
        from reportlab.lib.pagesizes import LETTER
        from reportlab.pdfgen import canvas
        return canvas, LETTER
    except ImportError as exc:  # pragma: no cover - honest not-ready hook
        raise UpstreamUnavailable(
            "reportlab not installed - PDF export unavailable (use render_html + print-to-PDF)",
            stage="report") from exc
