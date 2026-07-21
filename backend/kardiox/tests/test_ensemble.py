"""Trained ONNX ensemble port — safety + logic (no weights needed)."""
import math
from app.services import ensemble as ens


def test_not_ready_without_models_dir(monkeypatch):
    monkeypatch.delenv("KARDIOX_ENSEMBLE_MODELS_DIR", raising=False)
    # no models dir configured -> Not Ready -> classify never fabricates, returns []
    assert ens._models_dir() in (None, "")
    assert ens.classify({"leads": {"II": {"mv": [0.0] * 5000, "fs": 500}}}) == []


def test_label_map_af_aliases():
    # AF and AFIB must map to the SAME canonical finding so the engines fuse to one diagnosis.
    assert ens._LABEL["AF"][0] == ens._LABEL["AFIB"][0] == "Atrial fibrillation"
    assert ens._LABEL["STE"][1] == "critical"


def test_fuse_logodds_monotonic_and_bounded():
    a = ens._fuse_logodds([0.6])
    b = ens._fuse_logodds([0.6, 0.6])       # two agreeing positives -> higher consensus
    assert 0.0 < a < b < 1.0
    assert abs(ens._fuse_logodds([0.5]) - 0.5) < 1e-6


def test_prep_float_shape_and_znorm():
    import numpy as np
    x = np.random.RandomState(0).randn(12, 5000)
    out = ens._prep_float(x, {"samples": 5000}, np)
    assert out.shape == (1, 12, 5000)
    assert abs(float(out[0, 0].mean())) < 1e-4 and abs(float(out[0, 0].std()) - 1.0) < 1e-2
