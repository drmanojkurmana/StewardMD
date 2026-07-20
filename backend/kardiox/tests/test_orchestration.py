"""Phase 6B/6C — orchestration robustness (run_stage) + observability (IDs, readiness). No ML deps."""
from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.core.errors import PipelineTimeout, UpstreamUnavailable
from app.pipeline.orchestrator import run_stage


class FakeProvider:
    def __init__(self, timeout_s=5.0, max_retries=0, retry_on=(UpstreamUnavailable,)):
        self.timeout_s = timeout_s
        self.max_retries = max_retries
        self.retry_on = retry_on


async def _noemit(*a, **k):
    pass


def _run(coro):
    return asyncio.run(coro)


def test_stage_success():
    trace = []
    res, ok = _run(run_stage("s", FakeProvider(), lambda: _ok({"v": 1}),
                             critical=True, emit=_noemit, pct_active=1, pct_done=2, trace=trace))
    assert ok and res == {"v": 1} and trace[-1]["status"] == "done"


async def _ok(v):
    return v


def test_optional_stage_isolated_not_raised():
    trace = []

    async def boom():
        raise UpstreamUnavailable("boom", stage="s")

    res, ok = _run(run_stage("s", FakeProvider(), boom, critical=False, emit=_noemit,
                             pct_active=1, pct_done=2, trace=trace))
    assert ok is False and res is None and trace[-1]["status"] == "failed"


def test_critical_stage_raises_typed():
    async def boom():
        raise ValueError("unexpected")

    with pytest.raises(UpstreamUnavailable):
        _run(run_stage("s", FakeProvider(), boom, critical=True, emit=_noemit,
                       pct_active=1, pct_done=2, trace=[]))


def test_retry_then_success():
    calls = {"n": 0}

    async def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise UpstreamUnavailable("transient", stage="s")
        return "ok"

    res, ok = _run(run_stage("s", FakeProvider(max_retries=1), flaky, critical=True,
                             emit=_noemit, pct_active=1, pct_done=2, trace=[]))
    assert ok and res == "ok" and calls["n"] == 2


def test_timeout_maps_to_pipeline_timeout():
    async def slow():
        await asyncio.sleep(0.2)
        return 1

    with pytest.raises(PipelineTimeout):
        _run(run_stage("s", FakeProvider(timeout_s=0.01), slow, critical=True,
                       emit=_noemit, pct_active=1, pct_done=2, trace=[]))


# ── Observability endpoints ────────────────────────────────────────────────────────────────────────

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


def test_request_id_generated_and_echoed(client):
    r = client.get("/v1/health")
    assert r.headers.get("X-Request-ID") and r.headers.get("X-Correlation-ID")
    r2 = client.get("/v1/health", headers={"X-Request-ID": "abc123"})
    assert r2.headers["X-Request-ID"] == "abc123"


def test_ready_mock(client):
    r = client.get("/v1/ready")
    assert r.status_code == 200 and r.json()["ready"] is True
