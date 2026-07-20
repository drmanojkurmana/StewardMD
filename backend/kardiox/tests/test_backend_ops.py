"""Phase 5 backend expansion — metrics + async jobs. No ML deps; runs in the base 'test' job."""
from __future__ import annotations

import asyncio

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


def test_metrics_endpoint_and_counter(client):
    client.post("/v1/ecg/analyze", json={"sessionId": "m-1"})
    r = client.get("/metrics")
    assert r.status_code == 200
    body = r.text
    assert "kardiox_analyze_total" in body
    assert "kardiox_analyze_duration_seconds_count" in body


def test_jobs_submit_and_poll(client):
    r = client.post("/v1/ecg/jobs", json={"sessionId": "j-1"})
    assert r.status_code == 202
    job_id = r.json()["jobId"]
    assert r.json()["status"] == "queued"
    poll = client.get(f"/v1/ecg/jobs/{job_id}")
    assert poll.status_code == 200
    assert poll.json()["status"] in ("queued", "running", "done", "error")


def test_jobs_unknown_id_404(client):
    assert client.get("/v1/ecg/jobs/does-not-exist").status_code == 404


def test_job_runner_mock_produces_af():
    # Deterministic unit test of the background runner (no event-loop-timing flakiness).
    import app.api.v1.jobs as J
    from app.core.config import get_settings
    from app.models.ecg import AnalyzeRequest
    get_settings.cache_clear()
    s = get_settings()  # mock by default in test env? force it:
    import os
    os.environ["KARDIOX_MODE"] = "mock"
    get_settings.cache_clear()
    s = get_settings()
    J._put("jt-1", {"jobId": "jt-1", "status": "queued", "sessionId": "s"})
    asyncio.run(J._run("jt-1", AnalyzeRequest(sessionId="s"), s, None, None))
    assert J._JOBS["jt-1"]["status"] == "done"
    assert J._JOBS["jt-1"]["result"]["verdict"] == "Atrial fibrillation"
    get_settings.cache_clear()
