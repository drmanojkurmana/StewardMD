"""Concrete model backends (Phase 6F). Each lazy-imports its runtime and raises UpstreamUnavailable when
the runtime or checkpoint is missing — never fabricates output. See docs/MODEL_INTEGRATION.md."""
from __future__ import annotations

import os

from app.core.errors import UpstreamUnavailable
from app.services.models.base import ModelBackend, softmax


def _require_path(path, kind):
    if not path:
        raise UpstreamUnavailable(f"{kind} backend: no checkpoint path configured", stage="rhythm")
    if not os.path.exists(path):
        raise UpstreamUnavailable(f"{kind} backend: checkpoint not found at {path}", stage="rhythm")


class TorchScriptBackend(ModelBackend):
    kind = "torchscript"
    runtime_module = "torch"

    def load(self):
        if self._model is not None:
            return self._model
        _require_path(self.path, self.kind)
        try:
            import torch
        except ImportError as e:  # pragma: no cover
            raise UpstreamUnavailable("torch not installed", stage="rhythm") from e
        try:
            m = torch.jit.load(self.path, map_location="cpu")
            m.eval()
        except Exception as e:
            raise UpstreamUnavailable(f"torchscript load failed: {type(e).__name__}", stage="rhythm") from e
        self._model = m
        return m

    def infer(self, x_np):
        return softmax(self.raw(x_np))

    def raw(self, x_np):
        m = self.load()          # load() imports torch under a guard -> UpstreamUnavailable if absent
        import torch
        with torch.no_grad():
            out = m(torch.from_numpy(x_np))
        return out.detach().cpu().numpy()


class OnnxBackend(ModelBackend):
    kind = "onnx"
    runtime_module = "onnxruntime"

    def load(self):
        if self._model is not None:
            return self._model
        _require_path(self.path, self.kind)
        try:
            import onnxruntime as ort
        except ImportError as e:  # pragma: no cover
            raise UpstreamUnavailable("onnxruntime not installed", stage="rhythm") from e
        try:
            self._model = ort.InferenceSession(self.path, providers=["CPUExecutionProvider"])
        except Exception as e:
            raise UpstreamUnavailable(f"onnx load failed: {type(e).__name__}", stage="rhythm") from e
        return self._model

    def infer(self, x_np):
        return softmax(self.raw(x_np))

    def raw(self, x_np):
        sess = self.load()
        name = sess.get_inputs()[0].name
        return sess.run(None, {name: x_np})[0]


class StateDictBackend(ModelBackend):
    """A raw PyTorch state_dict needs its ARCHITECTURE to instantiate. Supply a `module_factory` callable
    (in opts) that returns an nn.Module; without it we raise (we can't guess the architecture)."""

    kind = "torch_statedict"
    runtime_module = "torch"

    def load(self):
        if self._model is not None:
            return self._model
        _require_path(self.path, self.kind)
        factory = self.opts.get("module_factory")
        if not callable(factory):
            raise UpstreamUnavailable("torch_statedict backend needs a module_factory (architecture)", stage="rhythm")
        try:
            import torch
        except ImportError as e:  # pragma: no cover
            raise UpstreamUnavailable("torch not installed", stage="rhythm") from e
        try:
            model = factory()
            model.load_state_dict(torch.load(self.path, map_location="cpu"))
            model.eval()
        except Exception as e:
            raise UpstreamUnavailable(f"state_dict load failed: {type(e).__name__}", stage="rhythm") from e
        self._model = model
        return model

    def infer(self, x_np):
        return softmax(self.raw(x_np))

    def raw(self, x_np):
        m = self.load()          # load() imports torch under a guard -> UpstreamUnavailable if absent
        import torch
        with torch.no_grad():
            out = m(torch.from_numpy(x_np))
        return out.detach().cpu().numpy()


class SavedModelBackend(ModelBackend):
    kind = "tensorflow"
    runtime_module = "tensorflow"

    def load(self):
        if self._model is not None:
            return self._model
        _require_path(self.path, self.kind)
        try:
            import tensorflow as tf
        except ImportError as e:  # pragma: no cover
            raise UpstreamUnavailable("tensorflow not installed", stage="rhythm") from e
        try:
            self._model = tf.saved_model.load(self.path)
        except Exception as e:
            raise UpstreamUnavailable(f"saved_model load failed: {type(e).__name__}", stage="rhythm") from e
        return self._model

    def infer(self, x_np):
        return softmax(self.raw(x_np))

    def raw(self, x_np):
        import numpy as np
        m = self.load()
        fn = getattr(m, "signatures", {}).get("serving_default") if hasattr(m, "signatures") else None
        out = (fn(**{list(fn.structured_input_signature[1])[0]: x_np}) if fn else m(x_np))
        return list(out.values())[0].numpy() if isinstance(out, dict) else np.asarray(out)


class EnsembleBackend(ModelBackend):
    """Combine several member backends by averaging their probability vectors. Members can be any objects
    exposing infer(x)->probs (real backends or, in tests, stubs)."""

    kind = "ensemble"
    runtime_module = ""

    def __init__(self, members, labels=None, **opts):
        super().__init__(path=None, labels=labels, **opts)
        self.members = list(members)

    def available(self) -> bool:  # type: ignore[override]
        return bool(self.members)

    def load(self):
        return self.members

    def infer(self, x_np):
        import numpy as np
        if not self.members:
            raise UpstreamUnavailable("ensemble has no members", stage="rhythm")
        stacked = np.stack([np.asarray(m.infer(x_np), dtype="float64").ravel() for m in self.members], axis=0)
        return stacked.mean(axis=0)

    def raw(self, x_np):
        # For encoders: CONCATENATE member embeddings (supports multiple foundation models simultaneously).
        import numpy as np
        if not self.members:
            raise UpstreamUnavailable("ensemble has no members", stage="rhythm")
        return np.concatenate([np.asarray(m.raw(x_np), dtype="float64").ravel() for m in self.members])


_BACKENDS = {
    "torchscript": TorchScriptBackend,
    "onnx": OnnxBackend,
    "torch_statedict": StateDictBackend,
    "tensorflow": SavedModelBackend,
}


def load_backend(kind: str, path: str | None = None, labels: list[str] | None = None, **opts) -> ModelBackend:
    """Construct a backend by kind. Hot-swap models by changing `kind`+`path` in config — no code change."""
    cls = _BACKENDS.get(kind)
    if not cls:
        raise UpstreamUnavailable(f"unknown model backend '{kind}' (have: {sorted(_BACKENDS)})", stage="rhythm")
    return cls(path=path, labels=labels, **opts)
