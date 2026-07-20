"""API + provider tests. Run: `pytest -q` (needs `pip install -r requirements.txt pytest`)."""
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


def test_health(client):
    r = client.get("/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["mode"] == "mock"
    stages = {s["stage"]: s for s in body["providers"]}
    assert len(stages) == 7
    assert stages["ruleValidation"]["implemented"] is True         # builtin is real
    assert stages["enhancement"]["implemented"] is False           # models pending


def test_analyze_mock_returns_af(client):
    r = client.post("/v1/ecg/analyze", json={"sessionId": "t-1"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.kardiox.v1+json")
    a = r.json()
    assert a["verdict"] == "Atrial fibrillation"
    assert a["confidence"] == 0.91 and a["confidenceBand"] == "high"
    assert a["measurements"]["qtcMs"] == 468 and a["measurements"]["ventRateBpm"] == 128
    assert a["sessionId"] == "t-1" and a["schemaVersion"] == "1.0"
    assert len(a["findings"]) == 3 and a["redFlag"]["title"] == "Anticoagulation check"


def test_openapi_available(client):
    assert client.get("/openapi.json").status_code == 200


def test_providers_not_implemented():
    from app.services.preprocessing import NonePreprocessing
    from app.core.errors import StageNotImplemented
    with pytest.raises(StageNotImplemented):
        asyncio.run(NonePreprocessing().enhance(b""))


def test_builtin_rules_af():
    from app.services.rules import BuiltinRules
    feat = {"regularity": "irregular", "pWaves": "absent", "prMs": None, "fWaves": True, "rrSdSec": 0.31, "qtcMs": 468, "qrsMs": 92, "ventRateBpm": 128}
    out = asyncio.run(BuiltinRules().validate(feat))
    af = [m for m in out["matched"] if m["cluster"] == "af"]
    assert len(af) == 3 and out["confidence"] == 0.82 and out["confidenceCapped"] is False


def test_builtin_rules_conflict_caps():
    from app.services.rules import BuiltinRules
    feat = {"regularity": "irregular", "pWaves": "absent", "prMs": None, "fWaves": True, "flutterWaves": True, "qtcMs": 400, "qrsMs": 90, "ventRateBpm": 110}
    out = asyncio.run(BuiltinRules().validate(feat))
    assert out["conflicts"] and out["confidence"] <= 0.6 and out["confidenceCapped"] is True
