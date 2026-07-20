"""EcgLib provider — pretrained Apache-2.0 classifiers, honest Not-Ready behaviour.

Label mapping is pure. Provider behaviour needs the config stack (get_settings) so it runs in CI; ecglib/
torch are never installed there, so the 'enabled' path still resolves to a clean Not-Ready (never fakes).
"""
from __future__ import annotations

import asyncio

import pytest

from app.core.errors import UpstreamUnavailable
from app.services.ecglib_provider import EcgLibClassifier, label_for, supported_pathologies


def test_label_mapping():
    assert label_for("AFIB") == "Atrial fibrillation"
    assert label_for("CRBBB") == "Complete right bundle branch block"
    assert label_for("PVC") == "Premature ventricular contractions"
    assert label_for("XYZ") == "XYZ"                      # unknown passes through, not fabricated
    assert len(supported_pathologies()) == 7


def test_disabled_by_default_is_not_ready(monkeypatch):
    monkeypatch.setenv("KARDIOX_ECGLIB_PATHOLOGIES", "")
    from app.core.config import get_settings
    get_settings.cache_clear()
    clf = EcgLibClassifier()
    assert clf.implemented is False and clf.validate_config()
    with pytest.raises(UpstreamUnavailable):
        asyncio.run(clf.classify({"leads": {"II": {"mv": [0, 1, 0], "fs": 500}}}))
    get_settings.cache_clear()


def test_enabled_but_library_absent_is_not_ready(monkeypatch):
    monkeypatch.setenv("KARDIOX_ECGLIB_PATHOLOGIES", "AFIB,1AVB,PVC")
    from app.core.config import get_settings
    get_settings.cache_clear()
    clf = EcgLibClassifier()
    assert clf.implemented is True and clf.validate_config() == []    # configured
    # ...but ecglib/torch are not installed -> Not Ready, never a fabricated result
    with pytest.raises(UpstreamUnavailable):
        asyncio.run(clf.classify({"leads": {"II": {"mv": [0.0] * 500, "fs": 500}}}))
    get_settings.cache_clear()


def test_health_reports_not_ready(monkeypatch):
    monkeypatch.setenv("KARDIOX_ECGLIB_PATHOLOGIES", "")
    from app.core.config import get_settings
    get_settings.cache_clear()
    h = asyncio.run(EcgLibClassifier().health())
    assert h["ready"] is False and any("EcgLib" in i for i in h["configIssues"])
    get_settings.cache_clear()
