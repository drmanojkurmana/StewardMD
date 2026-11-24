import pytest
from fastapi.testclient import TestClient
from app.main import app  # service root is added to PYTHONPATH by Research CI

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("RESEARCH_ENV", "test")
    return TestClient(app)

def test_health_is_public(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "stewardmd-research"

def test_meta_analysis_endpoint_is_retired(client):
    # Phase 0: the Python engine is retired; research-engine.js is canonical.
    response = client.post("/v1/meta-analysis/compute", json={
        "effect_measure": "RR",
        "studies": [
            {"study_id": "a", "label": "Trial A", "effect": 0.7, "ci_lower": 0.5, "ci_upper": 0.98},
            {"study_id": "b", "label": "Trial B", "effect": 0.8, "ci_lower": 0.6, "ci_upper": 1.06},
        ]})
    assert response.status_code == 404
