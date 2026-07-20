"""Phase 6 — Report assembly + FHIR export + HTML/PDF. Pure python (no numpy/cv2); runs in base CI.

Covers: build_report has every section + the mandated disclaimer in cautions; to_fhir emits a
DiagnosticReport + an HR Observation with LOINC 8867-4; render_html contains verdict + disclaimer;
render_pdf is an honest hook (raises UpstreamUnavailable when reportlab is absent, returns real PDF bytes
when present)."""
from __future__ import annotations

import importlib.util

import pytest

from app.core.errors import KardioXError, UpstreamUnavailable
from app.services import report as R


def _analysis() -> dict:
    return {
        "verdict": "Atrial fibrillation",
        "verdictQualifier": "with rapid ventricular response",
        "severity": "urgent",
        "confidence": 0.91,
        "confidenceBand": "high",
        "confidenceCapped": False,
        "measurements": {
            "heartRate": 128, "prMs": None, "qrsMs": 92, "qtMs": 388, "qtcMs": 468,
            "axisDeg": 42, "rhythm": "Irregularly irregular",
            "perLead": {"II": {"rAmpMv": 1.2, "sAmpMv": 0.3, "netMv": 0.9}}, "quality": 0.82,
        },
        "morphology": [
            {"label": "P waves", "value": "Absent"},
            {"label": "ST-segment", "value": "No acute change"},
        ],
        "clinicalInterpretation": "Irregularly irregular narrow-complex tachycardia with absent P waves.",
        "findings": [
            {"id": "f1", "title": "Irregularly irregular R-R", "detail": "RR variance 0.31s",
             "matched": True, "weight": 0.34, "severity": "urgent",
             "evidence": [{"lead": "II", "ruleId": "RHY-AF-01", "measuredValue": "RR variance 0.31s"}]},
        ],
        "differentials": [
            {"label": "Atrial fibrillation", "probability": 0.91},
            {"label": "Atrial flutter (variable)", "probability": 0.06},
        ],
        "whatToVerify": "Confirm no flutter waves in inferior leads; correlate with pulse.",
        "redFlag": {"title": "Anticoagulation check", "body": "Assess CHA2DS2-VASc and rate control."},
        "qualityReport": {"score": 0.74, "pass": True, "reasons": [], "metrics": {"focusVar": 88.0}},
        "signalQuality": 0.8,
    }


# ── build_report ─────────────────────────────────────────────────────────────────────────────────
def test_build_report_has_all_sections_and_disclaimer():
    rep = R.build_report(_analysis())
    for key in ("imageQuality", "signalQuality", "measurements", "interpretation", "confidence",
                "evidence", "differentials", "cautions", "followUp"):
        assert key in rep, f"missing section {key}"
    assert R.DISCLAIMER in rep["cautions"]
    assert rep["cautions"][0] == R.DISCLAIMER          # disclaimer is always first
    assert rep["interpretation"]["verdict"] == "Atrial fibrillation"


def test_build_report_measurements_are_only_present_values():
    rep = R.build_report(_analysis())
    keys = {m["key"] for m in rep["measurements"]}
    assert "heart-rate" in keys and "qtc-interval-ms" in keys
    assert "pr-interval-ms" not in keys                # prMs was None -> omitted, never fabricated
    hr = next(m for m in rep["measurements"] if m["key"] == "heart-rate")
    assert hr["value"] == 128 and hr["unit"] == "bpm"


def test_build_report_evidence_and_differentials_shaped():
    rep = R.build_report(_analysis())
    assert rep["evidence"][0]["ruleId"] == "RHY-AF-01"
    assert rep["evidence"][0]["lead"] == "II"
    assert rep["differentials"][0]["label"] == "Atrial fibrillation"
    assert rep["followUp"]["redFlag"]["title"] == "Anticoagulation check"


def test_build_report_low_confidence_adds_caution():
    a = _analysis()
    a["confidence"] = 0.4
    a["confidenceBand"] = "low"
    rep = R.build_report(a)
    assert any("Low model confidence" in c for c in rep["cautions"])
    assert rep["cautions"][0] == R.DISCLAIMER


def test_build_report_empty_analysis_is_safe():
    rep = R.build_report({})
    assert rep["cautions"] == [R.DISCLAIMER]
    assert rep["measurements"] == [] and rep["evidence"] == []
    assert rep["imageQuality"]["available"] is False


def test_build_report_rejects_non_dict():
    with pytest.raises(KardioXError):
        R.build_report("not a dict")  # type: ignore[arg-type]


# ── to_fhir ──────────────────────────────────────────────────────────────────────────────────────
def test_to_fhir_bundle_shape():
    bundle = R.to_fhir(_analysis())
    assert bundle["resourceType"] == "Bundle" and bundle["type"] == "collection"
    resources = [e["resource"] for e in bundle["entry"]]
    reports = [r for r in resources if r["resourceType"] == "DiagnosticReport"]
    assert len(reports) == 1
    dr = reports[0]
    assert dr["status"] == "preliminary"
    assert "cardiology" in dr["category"][0]["text"].lower()
    assert R.DISCLAIMER in dr["conclusion"] and "Atrial fibrillation" in dr["conclusion"]


def test_to_fhir_has_hr_observation_with_loinc_8867_4():
    bundle = R.to_fhir(_analysis())
    obs = [e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Observation"]
    assert len(obs) >= 1
    hr = [o for o in obs if any(c.get("code") == "8867-4" and c.get("system") == "http://loinc.org"
                                for c in o["code"]["coding"])]
    assert len(hr) == 1
    assert hr[0]["valueQuantity"]["value"] == 128
    # every DiagnosticReport.result reference resolves to a bundled Observation
    ids = {o["id"] for o in obs}
    refs = {ref["reference"].split("/", 1)[1] for ref in reports_result(bundle)}
    assert refs <= ids


def test_to_fhir_non_hr_uses_local_system_and_says_so():
    bundle = R.to_fhir(_analysis())
    obs = [e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Observation"]
    qtc = next(o for o in obs if o["id"] == "qtc-interval-ms")
    coding = qtc["code"]["coding"][0]
    assert coding["system"] == R.KARDIOX_FHIR_SYSTEM       # NOT an invented LOINC
    assert "local" in qtc["code"]["text"].lower()


def reports_result(bundle: dict) -> list[dict]:
    dr = next(e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "DiagnosticReport")
    return dr.get("result", [])


# ── render_html ──────────────────────────────────────────────────────────────────────────────────
def test_render_html_contains_verdict_and_disclaimer():
    rep = R.build_report(_analysis())
    doc = R.render_html(rep)
    assert doc.startswith("<!doctype html>")
    assert "Atrial fibrillation" in doc
    assert R.DISCLAIMER in doc


def test_render_html_accepts_raw_analysis_defensively():
    doc = R.render_html(_analysis())                       # not pre-built
    assert "Atrial fibrillation" in doc and R.DISCLAIMER in doc


def test_render_html_escapes_html():
    a = _analysis()
    a["verdict"] = "AF <script>alert(1)</script>"
    doc = R.render_html(R.build_report(a))
    assert "<script>alert(1)</script>" not in doc
    assert "&lt;script&gt;" in doc


# ── render_pdf (honest hook) ──────────────────────────────────────────────────────────────────────
def test_render_pdf_without_reportlab_raises():
    if importlib.util.find_spec("reportlab") is not None:
        pytest.skip("reportlab installed - hook returns a real PDF (see test below)")
    with pytest.raises(UpstreamUnavailable):
        R.render_pdf(R.build_report(_analysis()))


def test_render_pdf_with_reportlab_returns_pdf_bytes():
    pytest.importorskip("reportlab")
    data = R.render_pdf(R.build_report(_analysis()))
    assert isinstance(data, bytes) and data[:4] == b"%PDF"
