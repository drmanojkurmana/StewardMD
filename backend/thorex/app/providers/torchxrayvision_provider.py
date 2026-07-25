import numpy as np
import torch
from app.providers.base import InferenceProvider

_MODEL = None


def _model():
    global _MODEL
    if _MODEL is None:
        try:
            import torchxrayvision as xrv
            m = xrv.models.DenseNet(weights="densenet121-res224-all")
            m.eval()
            _MODEL = m
        except Exception as e:  # weights download / import failure
            raise RuntimeError(f"torchxrayvision unavailable: {e}")
    return _MODEL


class TorchXRayVisionProvider(InferenceProvider):
    name = "torchxrayvision"
    educational = False

    def detect(self, prepared) -> list[tuple[str, float]]:
        m = _model()
        t = torch.from_numpy(prepared.array[None, None, ...].astype("float32"))  # 1x1x224x224
        with torch.no_grad():
            out = m(t)[0].detach().cpu().numpy()
        pairs = list(zip(m.pathologies, [float(x) for x in out]))
        return [(lbl, p) for lbl, p in pairs if lbl]   # drop empty label slots
