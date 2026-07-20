"""Phase 7 — /v1/ecg/compare (serial) + /v1/ecg/report (report+FHIR+HTML). No ML deps (base CI 'test')."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("KARDIOX_MODE", "mock")
    monkeypatch.setenv("KARDIOX_PIPELINE_TOKEN", "")
    from app.core.config import get_settings
    get_settings.cache_clear()
    import app.api.deps as deps
    deps._providers = None
    from app.main import create_app
    return TestClient(create_app())


def _analysis(qtc=440, findings=None, verdict="Sinus rhythm"):
    return {"verdict": verdict, "severity": "info", "confidence": 0.7,
            "measurements": {"ventRateBpm": 72, "qtcMs": qtc, "axisDeg": 30},
            "findings": findings or [], "differentials": [], "whatToVerify": "correlate clinically"}


def test_compare_flags_new_af_and_qt(client):
    current = _analysis(qtc=470, findings=[{"title": "Atrial fibrillation"}], verdict="Atrial fibrillation")
    prior = _analysis(qtc=410, findings=[], verdict="Sinus rhythm")
    r = client.post("/v1/ecg/compare", json={"current": current, "prior": prior})
    assert r.status_code == 200
    body = r.json()
    assert body["flags"]["newAF"] is True
    assert body["flags"]["qtProlongationChange"] is True   # +60 ms
    assert body["trend"] == "worsened"
    assert body["deltas"]["qtcMs"] == 60.0


def test_report_builds_sections_fhir_and_html(client):
    r = client.post("/v1/ecg/report", json={"analysis": _analysis(verdict="Atrial fibrillation")})
    assert r.status_code == 200
    body = r.json()
    assert "report" in body and "fhir" in body and "html" in body
    assert body["fhir"]["resourceType"] == "Bundle"
    assert any(e["resource"]["resourceType"] == "DiagnosticReport" for e in body["fhir"]["entry"])
    # mandated disclaimer present in cautions + html
    cautions = " ".join(str(c) for c in body["report"]["cautions"])
    assert "not a diagnosis" in cautions.lower()
    assert "Atrial fibrillation" in body["html"] and "not a diagnosis" in body["html"].lower()


def test_report_requires_analysis(client):
    assert client.post("/v1/ecg/report", json={}).status_code == 422   # pydantic validation
