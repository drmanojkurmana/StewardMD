"""Asymmetric engine-isolation coverage for orchestrator.run.

v2beta pairs a clinical engine (torchxrayvision, educational=False) with an
educational adjunct (xraydar, educational=True). The clinical read is the
payload; the educational panel is a nice-to-have. These tests pin down the
asymmetric failure handling with small stub providers (no real weights,
no network) so they stay fast:

  - educational provider raises -> engine is skipped, clinical result still
    returns, no exception.
  - clinical provider raises -> propagates (caller/analyze.py turns this
    into a 503 inference_unavailable).
  - both succeed -> both engines present (sanity).

Guarantee under test: run() never returns a result whose ONLY engine is
educational, and never returns a result with zero engines - either the
clinical engine is present, or the whole request raises.
"""
import io

import numpy as np
import pytest
from PIL import Image

from app.pipeline import orchestrator


def _png_bytes() -> bytes:
    arr = (np.random.rand(256, 256) * 255).astype("uint8")
    buf = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return buf.getvalue()


class _StubProvider:
    """Mimics the InferenceProvider shape used by real providers."""

    def __init__(self, name: str, educational: bool, pairs=None, error: Exception | None = None):
        self.name = name
        self.educational = educational
        self._pairs = pairs or []
        self._error = error

    def detect(self, prepared):
        if self._error is not None:
            raise self._error
        return self._pairs


def _factory(providers):
    return lambda entitlement: providers


def test_educational_engine_failure_is_isolated_clinical_result_still_returned():
    clinical = _StubProvider(
        "torchxrayvision", educational=False, pairs=[("Pneumonia", 0.8)]
    )
    educational = _StubProvider(
        "xraydar", educational=True, error=RuntimeError("xraydar API down")
    )

    result = orchestrator.run(
        _png_bytes(), "chest.png", "v2beta", _factory([clinical, educational])
    )

    assert [e.engine for e in result.engines] == ["torchxrayvision"]
    assert result.engines[0].findings[0].label == "Pneumonia"


def test_clinical_engine_failure_propagates():
    clinical = _StubProvider(
        "torchxrayvision", educational=False, error=RuntimeError("model load failed")
    )
    educational = _StubProvider(
        "xraydar", educational=True, pairs=[("Effusion", 0.7)]
    )

    with pytest.raises(RuntimeError):
        orchestrator.run(
            _png_bytes(), "chest.png", "v2beta", _factory([clinical, educational])
        )


def test_both_engines_succeed_both_present():
    clinical = _StubProvider(
        "torchxrayvision", educational=False, pairs=[("Pneumonia", 0.8)]
    )
    educational = _StubProvider(
        "xraydar", educational=True, pairs=[("Effusion", 0.7)]
    )

    result = orchestrator.run(
        _png_bytes(), "chest.png", "v2beta", _factory([clinical, educational])
    )

    assert {e.engine for e in result.engines} == {"torchxrayvision", "xraydar"}
