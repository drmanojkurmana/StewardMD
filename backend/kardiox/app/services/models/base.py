"""Model-integration seam (Phase 6F) — the abstraction a trained ECG model plugs into.

A ModelBackend wraps ONE trained artifact (a TorchScript / ONNX / PyTorch state_dict / TF SavedModel /
ensemble) behind a uniform `predict(signal) -> {label, confidence, probs}`. Providers (e.g.
TorchECGRhythm) depend only on this interface, so a new model is dropped in by CONFIG — no change to the
provider, orchestrator, routes, or iOS app.

HARD RULE: a backend NEVER fabricates output. If its runtime is not installed, or its checkpoint path is
missing/unloadable, it raises UpstreamUnavailable — the pipeline then surfaces a clean pipeline_unavailable
naming the stage. We ship no weights.

Input contract: a signal dict → a normalized float32 array shaped (1, C, T) in `STANDARD_LEADS` order
(channels present in the signal). The exact channel count / length a checkpoint expects is documented
alongside that checkpoint (see docs/MODEL_INTEGRATION.md).
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from app.core.errors import UpstreamUnavailable
from app.services.base import module_available

STANDARD_LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]


def signal_tensor(signal: dict, order: list[str] | None = None):
    """signal dict -> normalized numpy (1, C, T). Raises UpstreamUnavailable if there are no leads."""
    import numpy as np
    leads = signal.get("leads", {}) or {}
    order = order or STANDARD_LEADS
    chans = []
    for name in order:
        mv = (leads.get(name) or {}).get("mv")
        if mv:
            x = np.asarray(mv, dtype="float32")
            x = (x - x.mean()) / (x.std() + 1e-6)
            chans.append(x)
    if not chans:
        raise UpstreamUnavailable("No leads available to classify", stage="rhythm")
    length = min(len(c) for c in chans)
    return np.stack([c[:length] for c in chans], axis=0)[None, :, :]


def softmax(logits):
    import numpy as np
    a = np.asarray(logits, dtype="float64").ravel()
    a = a - a.max()
    e = np.exp(a)
    return e / (e.sum() + 1e-12)


class ModelBackend(ABC):
    kind: str = "base"
    runtime_module: str = ""     # the python package needed to run it

    def __init__(self, path: str | None = None, labels: list[str] | None = None, **opts):
        self.path = path
        self.labels = labels or []
        self.opts = opts
        self._model = None

    @classmethod
    def available(cls) -> bool:
        return module_available(cls.runtime_module) if cls.runtime_module else True

    @abstractmethod
    def load(self):
        """Load the artifact once (cached in self._model). Raise UpstreamUnavailable on any problem."""

    @abstractmethod
    def infer(self, x_np):
        """Run inference on a numpy (1, C, T) input → numpy class-probability vector."""

    def raw(self, x_np):
        """Run the model and return its RAW output (no softmax) — for encoders/embeddings.

        Default subclasses may override for efficiency; the base runs infer()'s underlying model without
        the probability normalization. Concrete backends provide a proper raw() where it differs.
        """
        raise NotImplementedError(f"{self.kind} backend does not implement raw()")

    def predict(self, x_np) -> dict:
        import numpy as np
        probs = self.infer(x_np)
        idx = int(np.argmax(probs))
        label = self.labels[idx] if idx < len(self.labels) else f"class_{idx}"
        return {"label": label, "confidence": float(probs[idx]), "probs": [float(p) for p in probs]}

    def describe(self) -> dict:
        return {"kind": self.kind, "runtime": self.runtime_module, "available": self.available(),
                "path": self.path, "labels": len(self.labels)}
