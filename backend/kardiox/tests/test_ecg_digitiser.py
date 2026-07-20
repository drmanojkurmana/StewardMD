"""ECG-Digitiser wrapper — mapping, pre-digitized passthrough, Not-Ready honesty.

Needs the app config stack (get_settings) so it runs in CI (fastapi/pydantic installed there); ECG-Digitiser
itself is never installed, so the 'configured' paths still resolve to Not-Ready — never a fabricated signal.
"""
from __future__ import annotations

import pytest

from app.core.errors import BadImage, UpstreamUnavailable
from app.integrations.ecg_digitiser import _to_traces, digitize


def test_to_traces_builds_signal_passthrough():
    tr = _to_traces([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]], fs=500, leads=["I", "II"])
    assert tr["method"] == "ecg-digitiser" and tr["layout"] == "twelveLead3x4_rhythm"
    assert set(tr["leads"]) == {"I", "II"}                       # contract's top-level leads present
    sig = tr["signal"]
    assert sig["leads"]["II"]["mv"] == [0.4, 0.5, 0.6] and sig["leads"]["II"]["fs"] == 500
    assert sig["duration_s"] == round(3 / 500.0, 3)
    assert tr["calibration"]["method"] == "ecg-digitiser"


def test_to_signal_passthrough_uses_predigitized_signal():
    from app.services.wfdb_io import traces_to_signal
    traces = _to_traces([[1.0, 2.0], [3.0, 4.0]], fs=250, leads=["I", "II"])
    out = traces_to_signal(traces)                               # must pass through, not re-scale from px
    assert out["leads"]["I"]["mv"] == [1.0, 2.0] and out["leads"]["I"]["fs"] == 250


def test_not_ready_when_cmd_unset(monkeypatch):
    monkeypatch.setenv("KARDIOX_ECG_DIGITISER_CMD", "")
    from app.core.config import get_settings
    get_settings.cache_clear()
    with pytest.raises(UpstreamUnavailable):
        digitize(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    get_settings.cache_clear()


def test_empty_image_is_bad_image(monkeypatch):
    monkeypatch.setenv("KARDIOX_ECG_DIGITISER_CMD", "python -m x --input {input} --output {output}")
    from app.core.config import get_settings
    get_settings.cache_clear()
    with pytest.raises(BadImage):
        digitize(b"")
    get_settings.cache_clear()


def test_missing_command_binary_is_not_ready(monkeypatch):
    # a configured-but-nonexistent command -> Not Ready (FileNotFoundError mapped), never a fake signal
    monkeypatch.setenv("KARDIOX_ECG_DIGITISER_CMD",
                       "kardiox_no_such_binary_xyz --input {input} --output {output}")
    from app.core.config import get_settings
    get_settings.cache_clear()
    with pytest.raises(UpstreamUnavailable):
        digitize(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    get_settings.cache_clear()
