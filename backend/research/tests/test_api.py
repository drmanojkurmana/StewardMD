import pytest
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("RESEARCH_ENV", "test")
    monkeypatch.setenv("RESEARCH_WORKER_TOKEN", "test-secret")
    return TestClient(app)

def test_health_is_public(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "stewardmd-research"

def test_meta_analysis_requires_worker_token(client):
    payload = {"effect_measure":"RR","model":"random_dl","studies":[
        {"study_id":"a","label":"Trial A","effect":0.7,"ci_lower":0.5,"ci_upper":0.98},
        {"study_id":"b","label":"Trial B","effect":0.8,"ci_lower":0.6,"ci_upper":1.06}]}
    assert client.post("/v1/meta-analysis/compute",json=payload).status_code == 401
    ok = client.post("/v1/meta-analysis/compute",json=payload,headers={"x-research-worker-token":"test-secret"})
    assert ok.status_code == 200
    assert ok.json()["studiesIncluded"] == 2

def test_rejects_duplicate_study_ids(client):
    payload = {"effect_measure":"MD","studies":[
        {"study_id":"same","label":"A","effect":-1.0,"ci_lower":-2.0,"ci_upper":-0.1},
        {"study_id":"same","label":"B","effect":0.2,"ci_lower":0.1,"ci_upper":0.3}]}
    response = client.post("/v1/meta-analysis/compute",json=payload,headers={"x-research-worker-token":"test-secret"})
    assert response.status_code == 422
