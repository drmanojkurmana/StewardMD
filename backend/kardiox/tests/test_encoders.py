"""Foundation-encoder seam — Not-Ready honesty + registry + input specs.

Encoder metadata + input specs are checkable anywhere; encode()/health() need the config stack so they
run in CI. Encoders ship no weights, so 'configured' still resolves to Not-Ready (never a fake embedding).
"""
from __future__ import annotations

import pytest

from app.core.errors import UpstreamUnavailable
from app.services.models.encoders import (DeepECGSSLEncoder, ECGFMEncoder, HeartGPTEncoder, build_encoders,
                                          get_encoder)


def test_encoder_metadata_and_input_specs():
    assert ECGFMEncoder().license == "MIT" and ECGFMEncoder().input_spec == "ecgfm_500hz_5s"
    assert DeepECGSSLEncoder().license == "Apache-2.0" and DeepECGSSLEncoder().input_spec == "deepecg_250hz_10s"
    assert HeartGPTEncoder().license == "MIT" and HeartGPTEncoder().input_spec == "heartgpt_leadii"
    from app.services.models.adapters import INPUT_SPECS
    for s in ("ecgfm_500hz_5s", "deepecg_250hz_10s", "heartgpt_leadii"):
        assert s in INPUT_SPECS


def test_registry_and_unknown():
    names = {e.name for e in build_encoders()}
    assert {"ecg-fm", "deepecg-ssl", "heartgpt"} <= names
    assert get_encoder("ecg-fm").name == "ecg-fm"
    with pytest.raises(KeyError):
        get_encoder("nope")


def test_not_ready_without_checkpoint(monkeypatch):
    monkeypatch.setenv("KARDIOX_ENCODERS_JSON", "{}")
    from app.core.config import get_settings
    get_settings.cache_clear()
    enc = ECGFMEncoder()
    assert enc.implemented is False and enc.validate_config()
    with pytest.raises(UpstreamUnavailable):
        enc.encode({"leads": {"II": {"mv": [0.0] * 500, "fs": 500}}})
    get_settings.cache_clear()


def test_configured_but_missing_file_is_not_ready(monkeypatch):
    monkeypatch.setenv("KARDIOX_ENCODERS_JSON", '{"ecg-fm": {"path": "/nope/ecgfm.onnx", "kind": "onnx"}}')
    from app.core.config import get_settings
    get_settings.cache_clear()
    enc = ECGFMEncoder()
    assert enc.implemented is True                         # a checkpoint is wired
    assert any("not found" in i for i in enc.validate_config())   # ...but the file is absent
    get_settings.cache_clear()


def test_health_reports_not_ready(monkeypatch):
    import asyncio
    monkeypatch.setenv("KARDIOX_ENCODERS_JSON", "{}")
    from app.core.config import get_settings
    get_settings.cache_clear()
    h = asyncio.run(HeartGPTEncoder().health())
    assert h["ready"] is False and h["license"] == "MIT" and any("checkpoint" in i for i in h["configIssues"])
    get_settings.cache_clear()
