"""Phase 6F — model-integration seam. Needs numpy (ensemble/tensor math) → CI 'test-ml' job.

We ship no weights, so we test the SEAM, not real inference: tensor contract, honest not-ready behaviour
(no runtime/checkpoint → raises, never fabricates), the factory, and ensemble averaging via stub members.
"""
from __future__ import annotations

import pytest

from app.core.errors import UpstreamUnavailable

np = pytest.importorskip("numpy")

from app.services.models import (EnsembleBackend, TorchScriptBackend, load_backend,  # noqa: E402
                                 signal_tensor, softmax)


def _sig(n=500):
    return {"leads": {"II": {"mv": list(np.sin(np.arange(n) / 10.0)), "fs": 500},
                      "V1": {"mv": list(np.cos(np.arange(n) / 10.0)), "fs": 500}}}


def test_signal_tensor_shape_and_norm():
    x = signal_tensor(_sig())
    assert x.shape[0] == 1 and x.shape[1] == 2      # (1, C, T), 2 leads present
    assert abs(float(x[0, 0].mean())) < 1e-4        # z-scored per channel


def test_signal_tensor_no_leads_raises():
    with pytest.raises(UpstreamUnavailable):
        signal_tensor({"leads": {}})


def test_softmax_sums_to_one():
    p = softmax([1.0, 2.0, 3.0])
    assert abs(float(p.sum()) - 1.0) < 1e-9 and p.argmax() == 2


def test_load_backend_unknown_kind_raises():
    with pytest.raises(UpstreamUnavailable):
        load_backend("magic", "/x")


def test_torchscript_backend_no_checkpoint_raises():
    # available() reflects whether torch is importable; load() must raise without a real checkpoint,
    # never fabricate a model.
    b = TorchScriptBackend(path="/nonexistent/model.pt")
    with pytest.raises(UpstreamUnavailable):
        b.load()


class _Stub:
    def __init__(self, probs, emb=None):
        self._p = np.asarray(probs, dtype="float64")
        self._emb = np.asarray(emb if emb is not None else probs, dtype="float64")

    def infer(self, x_np):
        return self._p

    def raw(self, x_np):
        return self._emb


def test_ensemble_averages_and_predicts():
    ens = EnsembleBackend([_Stub([0.2, 0.8]), _Stub([0.6, 0.4])], labels=["sinus", "af"])
    avg = ens.infer(np.zeros((1, 2, 10)))
    assert abs(avg[0] - 0.4) < 1e-9 and abs(avg[1] - 0.6) < 1e-9
    pred = ens.predict(np.zeros((1, 2, 10)))
    assert pred["label"] == "af" and abs(pred["confidence"] - 0.6) < 1e-9


def test_ensemble_empty_raises():
    with pytest.raises(UpstreamUnavailable):
        EnsembleBackend([]).infer(np.zeros((1, 2, 10)))


def test_ensemble_raw_concatenates_embeddings():
    # encoders: raw() CONCATENATES member embeddings (not averaged) — enables multiple encoders at once
    ens = EnsembleBackend([_Stub([0.0], emb=[1.0, 2.0]), _Stub([0.0], emb=[3.0, 4.0, 5.0])])
    cat = ens.raw(np.zeros((1, 2, 10)))
    assert list(cat) == [1.0, 2.0, 3.0, 4.0, 5.0]
