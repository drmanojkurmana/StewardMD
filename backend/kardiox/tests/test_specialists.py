"""Phase 7 — specialist model classifiers. Honesty-first: Not Ready until a checkpoint is configured.

The Not-Ready + registry + health tests need no ML deps (base CI 'test'); the 'configured but checkpoint
missing' test importorskips numpy (adapt_signal runs before the load attempt).
"""
from __future__ import annotations

import asyncio

import pytest

from app.core.errors import UpstreamUnavailable
from app.services.specialists import STANDARD_SPECIALISTS, ModelClassifier, build_specialists, run_specialists


def test_no_config_is_not_ready():
    mi = ModelClassifier("mi")
    assert mi.validate_config()                       # reports a missing-checkpoint issue
    with pytest.raises(UpstreamUnavailable):
        asyncio.run(mi.classify({"leads": {"II": {"mv": [0, 1, 0], "fs": 500}}}))


def test_health_reports_not_ready():
    h = asyncio.run(ModelClassifier("rareDisease").health())
    assert h["ready"] is False and h["name"] == "rareDisease-model"
    assert any("checkpoint" in i.lower() for i in h["configIssues"])


def test_build_specialists_covers_standard_tasks():
    tasks = [s.task for s in build_specialists()]
    for t in STANDARD_SPECIALISTS:
        assert t in tasks
    assert "mi" in tasks and "conduction" in tasks and "beat" in tasks


def test_run_specialists_isolates_not_ready():
    # None configured → every specialist is Not Ready → isolated → no candidates, no raise.
    out = asyncio.run(run_specialists({"leads": {"II": {"mv": [0.0] * 100, "fs": 500}}}, build_specialists()))
    assert out == []


def test_extra_task_from_registry(monkeypatch):
    monkeypatch.setenv("KARDIOX_SPECIALISTS_JSON", '{"lqts": {"path": ""}}')
    from app.core.config import get_settings
    get_settings.cache_clear()
    assert "lqts" in [s.task for s in build_specialists()]   # custom task, no code change
    get_settings.cache_clear()


def test_configured_but_missing_checkpoint_raises(monkeypatch):
    pytest.importorskip("numpy")
    monkeypatch.setenv("KARDIOX_SPECIALISTS_JSON",
                       '{"mi": {"path": "/nonexistent/mi.onnx", "kind": "onnx", "labels": "norm,mi"}}')
    from app.core.config import get_settings
    get_settings.cache_clear()
    mi = ModelClassifier("mi")
    assert mi.implemented is True                       # a checkpoint is now WIRED for this task
    assert any("not found" in i for i in mi.validate_config())   # ...but the file does not exist → not ready
    with pytest.raises(UpstreamUnavailable):           # classify never fabricates — it raises
        asyncio.run(mi.classify({"leads": {"II": {"mv": [0.0] * 500, "fs": 500}}}))
    get_settings.cache_clear()
