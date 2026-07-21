"""NSTEMI engine adapter (dgedon/nstemi_prediction, Gedon et al.) — Ribeiro-style SE-ResNet1d ensemble
predicting NSTEMI from an 8-lead ECG.

HONEST BLOCKER: the upstream repo ships TEST CODE ONLY — the trained weights are "available upon request"
from the author (daniel.gedon@uni-tuebingen.de); there is NO public checkpoint. So this engine is
Not-Ready (raises UpstreamUnavailable) until an operator installs the weights and points
KARDIOX_NSTEMI_LOG_DIR at them. This adapter wires the integration + provides an ONNX export helper so
the engine drops into the KardioX multi-engine registry (kardiox-engines.js: 'nstemi') the moment
weights exist — it never fabricates an NSTEMI probability.

Wiring (operator, once weights obtained):
  KARDIOX_NSTEMI_LOG_DIR=/path/to/nstemi_prediction/logs   # contains config.json + model weights
  KARDIOX_NSTEMI_REPO=/path/to/nstemi_prediction           # for model.py (EnsembleECGModel)
  python -m app.integrations.nstemi --export engines/nstemi.onnx
Input spec: 8-lead ECG (the reduced set the model was trained on), per its dataloader.
"""
from __future__ import annotations

from app.core.errors import UpstreamUnavailable

_STAGE = "rhythm"
NSTEMI_LEADS_DEFAULT = 8


def _settings():
    from app.core.config import get_settings
    return get_settings()


def _load_model():
    """Load EnsembleECGModel from operator-installed weights, or raise Not-Ready. Never fabricates."""
    import os
    import sys
    log_dir = (getattr(_settings(), "nstemi_log_dir", "") or os.environ.get("KARDIOX_NSTEMI_LOG_DIR", "")).strip()
    repo = (getattr(_settings(), "nstemi_repo", "") or os.environ.get("KARDIOX_NSTEMI_REPO", "")).strip()
    if not log_dir or not repo:
        raise UpstreamUnavailable(
            "NSTEMI NOT READY: dgedon/nstemi_prediction ships no public weights (available on request "
            "from the author). Set KARDIOX_NSTEMI_REPO + KARDIOX_NSTEMI_LOG_DIR once obtained.", stage=_STAGE)
    if not os.path.isdir(log_dir):
        raise UpstreamUnavailable(f"NSTEMI weights dir not found: {log_dir}", stage=_STAGE)
    import json
    if repo not in sys.path:
        sys.path.insert(0, repo)
    try:
        import torch  # noqa: F401
        from model import EnsembleECGModel
    except ImportError as e:
        raise UpstreamUnavailable(f"NSTEMI runtime not installed ({e})", stage=_STAGE) from e
    cfg_path = os.path.join(log_dir, "config.json")
    if not os.path.exists(cfg_path):
        raise UpstreamUnavailable("NSTEMI config.json missing in log dir", stage=_STAGE)
    with open(cfg_path) as f:
        config = json.load(f)
    return EnsembleECGModel(config, log_dir)


def predict(signal_8lead) -> dict:
    """Return {'NSTEMI': prob} from an 8-lead signal tensor, or raise Not-Ready. Never fabricates."""
    import torch
    model = _load_model()
    model.eval()
    with torch.no_grad():
        logits = model(signal_8lead)
        prob = float(torch.sigmoid(logits).flatten()[0])
    return {"NSTEMI": prob}


def export_onnx(out_path: str, n_leads: int = NSTEMI_LEADS_DEFAULT, n_samples: int = 4096) -> str:
    """Export the operator-installed NSTEMI model to ONNX for the on-device engine registry."""
    import torch
    model = _load_model()
    model.eval()
    x = torch.randn(1, n_leads, n_samples)
    torch.onnx.export(model, x, out_path, input_names=["ecg"], output_names=["logits"],
                      dynamic_axes={"ecg": {0: "batch"}}, opset_version=17)
    return out_path


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", type=str, help="export ONNX to this path")
    a = ap.parse_args()
    if a.export:
        print("exported", export_onnx(a.export))
    else:
        print("NSTEMI adapter: set KARDIOX_NSTEMI_REPO + KARDIOX_NSTEMI_LOG_DIR (weights on request), then --export")
