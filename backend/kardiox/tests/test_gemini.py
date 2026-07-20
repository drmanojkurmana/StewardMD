"""Gemini explainer — safety-critical prompt constraints + disclaimer enforcement + no-key path."""
from __future__ import annotations

import asyncio

import pytest

from app.services.gemini import DISCLAIMER, GeminiExplainer, build_explanation_prompt, enforce_disclaimer

VALIDATED = {
    "features": {"ventRateBpm": 128, "qtcMs": 468, "qrsMs": 92},
    "validated": {
        "matched": [
            {"title": "Absent P waves", "detail": "No consistent atrial activity", "weight": 0.29},
            {"title": "Irregularly irregular R-R", "detail": "RR variance 0.31s", "weight": 0.34},
        ],
        "whatToVerify": "Confirm no flutter waves in inferior leads.",
    },
}


def test_prompt_contains_only_validated_findings():
    p = build_explanation_prompt(VALIDATED)
    assert "Absent P waves" in p and "Irregularly irregular R-R" in p
    assert "ventRateBpm=128" in p and "qtcMs=468" in p
    assert "Confirm no flutter waves" in p


def test_prompt_forbids_additions():
    p = build_explanation_prompt(VALIDATED)
    assert "MUST NOT introduce" in p                 # system guardrail present
    assert "Do NOT add any finding or diagnosis" in p
    # a diagnosis NOT in the validated set must not appear in the prompt
    assert "STEMI" not in p and "atrial flutter" not in p.lower()


def test_prompt_handles_empty():
    p = build_explanation_prompt({})
    assert "(none)" in p and "MUST NOT introduce" in p


def test_enforce_disclaimer_appends_and_dedupes():
    assert DISCLAIMER in enforce_disclaimer("Some explanation.")
    once = enforce_disclaimer("Some explanation. " + DISCLAIMER)
    assert once.lower().count(DISCLAIMER.lower()) == 1


def test_explain_without_key_raises(monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setenv("KARDIOX_GEMINI_API_KEY", "")
    get_settings.cache_clear()
    from app.core.errors import UpstreamUnavailable
    with pytest.raises(UpstreamUnavailable):
        asyncio.run(GeminiExplainer().explain(VALIDATED))
    get_settings.cache_clear()
