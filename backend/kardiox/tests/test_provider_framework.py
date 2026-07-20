"""Phase 6A — provider capability surface. No ML deps (health/version/deps/config are pure).

Runs in the base CI 'test' job. Verifies every provider exposes the production surface and that the
model-backed providers correctly report a NOT-READY state (missing checkpoint / API key) instead of
pretending to work.
"""
from __future__ import annotations

import asyncio


def _reports(providers):
    return asyncio.run(asyncio.gather(*(p.health() for p in providers.all())))


def _build(monkeypatch, **env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    from app.core.config import get_settings
    get_settings.cache_clear()
    from app.services.registry import build_providers
    return build_providers(get_settings())


def test_every_provider_has_capability_surface(monkeypatch):
    provs = _build(monkeypatch)
    reports = _reports(provs)
    assert len(reports) == 8
    stages = {r["stage"] for r in reports}
    assert {"enhancement", "quality", "digitization", "signalExtraction", "rhythm",
            "measurement", "ruleValidation", "clinicalExplanation"} == stages
    for r in reports:
        assert r["name"] and r["version"]
        assert {"implemented", "ready", "dependencies", "configIssues", "policy"} <= set(r)
        assert {"timeoutS", "maxRetries"} <= set(r["policy"])
    from app.core.config import get_settings
    get_settings.cache_clear()


def test_builtin_rules_ready(monkeypatch):
    provs = _build(monkeypatch)
    rules = next(p for p in provs.all() if p.stage == "ruleValidation")
    h = asyncio.run(rules.health())
    assert h["implemented"] is True and h["ready"] is True
    from app.core.config import get_settings
    get_settings.cache_clear()


def test_torchecg_not_ready_without_checkpoint(monkeypatch):
    provs = _build(monkeypatch, KARDIOX_PROVIDER_RHYTHM="torchecg", KARDIOX_RHYTHM_MODEL_PATH="")
    rhythm = next(p for p in provs.all() if p.stage == "rhythm")
    h = asyncio.run(rhythm.health())
    assert h["ready"] is False
    assert any("checkpoint" in i.lower() or "model_path" in i.lower() for i in h["configIssues"])
    from app.core.config import get_settings
    get_settings.cache_clear()


def test_gemini_not_ready_without_key(monkeypatch):
    provs = _build(monkeypatch, KARDIOX_PROVIDER_GEMINI="gemini", KARDIOX_GEMINI_API_KEY="")
    gem = next(p for p in provs.all() if p.stage == "clinicalExplanation")
    h = asyncio.run(gem.health())
    assert h["implemented"] is True and h["ready"] is False   # code done, key missing
    assert any("KEY" in i.upper() for i in h["configIssues"])
    from app.core.config import get_settings
    get_settings.cache_clear()
