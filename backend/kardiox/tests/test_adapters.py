"""Model adapters — input spec, label map, entrypoint resolver, external digitizer.

Label-map/resolver/external-unset tests need no ML deps (base CI 'test'); adapt_signal tests importorskip
numpy (CI 'test-ml'). We test the ADAPTER MECHANICS, never model performance (we ship no weights).
"""
from __future__ import annotations

import asyncio

import pytest

from app.core.errors import UpstreamUnavailable
from app.services.models import LabelMap, get_input_spec, get_label_map, resolve_entrypoint


def test_label_map_translate_case_insensitive():
    lm = LabelMap({"AF": "atrial fibrillation"}, default="unknown")
    assert lm.translate("af") == "atrial fibrillation"
    assert lm.translate("VT") == "unknown"          # default for unmapped


def test_ptbxl_superclass_preset():
    lm = get_label_map("ptbxl_superclass")
    assert lm.translate("NORM") == "sinus rhythm"
    assert "candidate" in lm.translate("MI")        # diagnoses flagged as model candidates


def test_resolve_entrypoint_ok_and_errors():
    import json
    assert resolve_entrypoint("json:loads") is json.loads
    with pytest.raises(UpstreamUnavailable):
        resolve_entrypoint("no-colon")
    with pytest.raises(UpstreamUnavailable):
        resolve_entrypoint("nonexistent_module_xyz:fn")
    with pytest.raises(UpstreamUnavailable):
        resolve_entrypoint("json:not_a_real_attr")


def test_external_digitization_not_ready_without_entrypoint(monkeypatch):
    monkeypatch.setenv("KARDIOX_DIGITIZER_ENTRYPOINT", "")
    from app.core.config import get_settings
    get_settings.cache_clear()
    from app.services.digitization import ExternalDigitization
    prov = ExternalDigitization()
    assert prov.validate_config()                    # reports a config issue
    with pytest.raises(UpstreamUnavailable):
        asyncio.run(prov.digitize(b"x"))
    get_settings.cache_clear()


# ── adapt_signal (needs numpy) ──────────────────────────────────────────────────────────────────────

def _np():
    return pytest.importorskip("numpy")


def test_adapt_signal_shape_resample_and_fill():
    np = _np()
    from app.services.models import adapt_signal
    spec = get_input_spec("ptbxl_500hz_10s")          # fs=500, 5000 samples, 12 leads
    # provide only 2 leads at 250 Hz, 1250 samples (=5 s) → resampled to 500 Hz + padded to 5000
    sig = {"leads": {"II": {"mv": list(np.sin(np.arange(1250) / 8.0)), "fs": 250},
                     "V1": {"mv": list(np.cos(np.arange(1250) / 8.0)), "fs": 250}}}
    x = adapt_signal(sig, spec)
    assert x.shape == (1, 12, 5000)                   # 12 channels (missing ones zero-filled), 5000 samples
    # present channels are z-scored (mean ~0); absent channels are all-zero
    assert abs(float(x[0, 1].mean())) < 1e-3          # lead II present
    assert float(np.abs(x[0, 3]).sum()) == 0.0        # aVR absent → zeros


def test_adapt_signal_missing_required_raises_when_strict():
    _np()
    from app.services.models import ModelInputSpec, adapt_signal
    spec = ModelInputSpec(fs=500, num_samples=100, leads=["II", "V6"], fill_missing=False)
    with pytest.raises(UpstreamUnavailable):
        adapt_signal({"leads": {"II": {"mv": [0.0] * 100, "fs": 500}}}, spec)


def test_adapt_signal_native_length_when_num_samples_none():
    np = _np()
    from app.services.models import ModelInputSpec, adapt_signal
    spec = ModelInputSpec(fs=500, num_samples=None, leads=["II"], normalize="none")
    x = adapt_signal({"leads": {"II": {"mv": list(range(300)), "fs": 500}}}, spec)
    assert x.shape == (1, 1, 300)
